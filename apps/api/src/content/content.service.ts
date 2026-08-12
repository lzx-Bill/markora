import { loadServerConfig } from "@markora/config";
import type {
  BulkDocumentRequest,
  BulkDocumentResult,
  CreateDocumentRequest,
  CreateFolderRequest,
  DocumentDetail,
  DocumentList,
  DocumentSummary,
  Folder,
  FolderTree,
  FolderTreeNode,
  Principal,
  TrashResult,
  UpdateDocumentRequest,
  UpdateFolderRequest,
  WorkspaceSummary,
} from "@markora/contracts";
import { Prisma, ResourceState } from "@markora/database";
import {
  analyzeHierarchy,
  assertFolderMove,
  InvalidHierarchyError,
  InvalidNameError,
  NamingPolicy,
} from "@markora/domain";
import { Inject, Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service.js";
import { CodedHttpException } from "../http/coded-http.exception.js";
import { ContentRepository, visibleFolders } from "./content.repository.js";

@Injectable()
export class ContentService {
  @Inject(DatabaseService)
  private readonly database!: DatabaseService;

  @Inject(ContentRepository)
  private readonly repository!: ContentRepository;

  private readonly config = loadServerConfig(process.env);
  private readonly names = new NamingPolicy({
    maxCodePoints: this.config.WORKSPACE_NAME_MAX_CODE_POINTS,
  });

  public async workspace(principal: Principal): Promise<WorkspaceSummary> {
    const workspace = await this.database.client.workspace.findUniqueOrThrow({
      where: { id: principal.workspaceId, ownerUserId: principal.userId },
    });
    const [rootFolderCount, rootDocumentCount] = await Promise.all([
      this.database.client.folder.count({
        where: { workspaceId: principal.workspaceId, parentId: null, state: ResourceState.ACTIVE },
      }),
      this.database.client.document.count({
        where: { workspaceId: principal.workspaceId, folderId: null, state: ResourceState.ACTIVE },
      }),
    ]);
    return {
      id: workspace.id,
      ownerUserId: workspace.ownerUserId,
      rootFolderCount,
      rootDocumentCount,
    };
  }

  public async folderTree(principal: Principal): Promise<FolderTree> {
    const folders = await this.repository.listVisibleFolders(principal.workspaceId);
    const documents = await this.database.client.document.findMany({
      where: { workspaceId: principal.workspaceId, state: ResourceState.ACTIVE },
      select: { folderId: true },
    });
    const visibleIds = new Set(folders.map((folder) => folder.id));
    const directCounts = new Map<string, number>();
    for (const document of documents) {
      if (document.folderId && visibleIds.has(document.folderId)) {
        directCounts.set(document.folderId, (directCounts.get(document.folderId) ?? 0) + 1);
      }
    }
    const nodes = new Map<string, FolderTreeNode>();
    for (const folder of folders) {
      nodes.set(folder.id, {
        id: folder.id,
        parentId: folder.parentId,
        name: folder.name,
        documentCount: directCounts.get(folder.id) ?? 0,
        updatedAt: folder.updatedAt.toISOString(),
        children: [],
      });
    }
    const roots: FolderTreeNode[] = [];
    for (const folder of folders) {
      const node = nodes.get(folder.id);
      if (!node) continue;
      const parent = folder.parentId ? nodes.get(folder.parentId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    const accumulate = (node: FolderTreeNode): number => {
      const count = node.children.reduce(
        (total, child) => total + accumulate(child),
        node.documentCount,
      );
      node.documentCount = count;
      return count;
    };
    for (const root of roots) accumulate(root);
    const latest = folders.reduce(
      (value, folder) => Math.max(value, folder.updatedAt.getTime()),
      0,
    );
    return { data: roots, versionToken: `${folders.length}:${latest}` };
  }

  public async createFolder(
    principal: Principal,
    input: CreateFolderRequest,
    requestId: string,
  ): Promise<Folder> {
    const name = this.validateName(input.name, "folder");
    try {
      const folder = await this.database.client.$transaction(
        async (transaction) => {
          const folders = await visibleFolders(transaction, principal.workspaceId);
          this.assertTargetFolder(folders, input.parentId);
          const analysis = analyzeHierarchy(folders);
          const parentDepth = input.parentId ? (analysis.depthById.get(input.parentId) ?? 0) : 0;
          if (parentDepth + 1 > this.config.WORKSPACE_MAX_DEPTH) this.throwDepthLimit();
          await this.assertFolderNameAvailable(
            transaction,
            principal.workspaceId,
            input.parentId,
            name.normalizedName,
          );
          const created = await transaction.folder.create({
            data: { workspaceId: principal.workspaceId, parentId: input.parentId, ...name },
          });
          await this.audit(
            transaction,
            principal,
            "folder.create",
            "folder",
            created.id,
            requestId,
          );
          return created;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return folderDto(folder);
    } catch (error) {
      this.rethrowMutationError(error);
    }
  }

  public async updateFolder(
    principal: Principal,
    folderId: string,
    input: UpdateFolderRequest,
    requestId: string,
  ): Promise<Folder> {
    const validatedName =
      input.name === undefined ? undefined : this.validateName(input.name, "folder");
    try {
      const folder = await this.database.client.$transaction(
        async (transaction) => {
          const folders = await visibleFolders(transaction, principal.workspaceId);
          const current = folders.find((candidate) => candidate.id === folderId);
          if (!current) this.throwNotFound("Folder");
          this.assertMetadataToken(current.updatedAt, input.expectedUpdatedAt);
          const parentId = input.parentId === undefined ? current.parentId : input.parentId;
          this.assertTargetFolder(folders, parentId);
          try {
            assertFolderMove(
              analyzeHierarchy(folders),
              folderId,
              parentId,
              this.config.WORKSPACE_MAX_DEPTH,
            );
          } catch (error) {
            if (error instanceof InvalidHierarchyError && error.reason === "cycle") {
              throw new CodedHttpException(
                "FOLDER_CYCLE",
                "A folder cannot be moved into itself or its descendant.",
                422,
              );
            }
            if (error instanceof InvalidHierarchyError && error.reason === "depth")
              this.throwDepthLimit();
            throw error;
          }
          const nextName = validatedName ?? {
            name: current.name,
            normalizedName: current.normalizedName,
          };
          await this.assertFolderNameAvailable(
            transaction,
            principal.workspaceId,
            parentId,
            nextName.normalizedName,
            folderId,
          );
          const updated = await transaction.folder.update({
            where: { id: folderId },
            data: { parentId, ...nextName },
          });
          await this.audit(transaction, principal, "folder.update", "folder", folderId, requestId, {
            parentId,
          });
          return updated;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return folderDto(folder);
    } catch (error) {
      this.rethrowMutationError(error);
    }
  }

  public async trashFolder(
    principal: Principal,
    folderId: string,
    requestId: string,
  ): Promise<TrashResult> {
    const trashedAt = new Date();
    await this.database.client.$transaction(async (transaction) => {
      const folders = await visibleFolders(transaction, principal.workspaceId);
      const folder = folders.find((candidate) => candidate.id === folderId);
      if (!folder) this.throwNotFound("Folder");
      await transaction.folder.update({
        where: { id: folder.id },
        data: {
          state: ResourceState.TRASHED,
          originalParentId: folder.parentId,
          deletedAt: trashedAt,
        },
      });
      await this.audit(transaction, principal, "folder.trash", "folder", folderId, requestId);
    });
    return { success: true, trashedAt: trashedAt.toISOString() };
  }

  public async listDocuments(principal: Principal, folderId: string | null): Promise<DocumentList> {
    if (
      folderId !== null &&
      !(await this.repository.findVisibleFolder(principal.workspaceId, folderId))
    ) {
      this.throwNotFound("Folder");
    }
    const documents = await this.repository.listDocuments(principal.workspaceId, folderId);
    return { data: documents.map(documentSummary) };
  }

  public async createDocument(
    principal: Principal,
    input: CreateDocumentRequest,
    requestId: string,
  ): Promise<DocumentDetail> {
    const name = this.validateName(input.name, "document");
    if (Buffer.byteLength(input.markdown, "utf8") > this.config.DOCUMENT_MAX_BYTES) {
      throw new CodedHttpException("LIMIT_EXCEEDED", "The Markdown document is too large.", 413);
    }
    try {
      const document = await this.database.client.$transaction(
        async (transaction) => {
          const folders = await visibleFolders(transaction, principal.workspaceId);
          this.assertTargetFolder(folders, input.folderId);
          await this.assertDocumentNameAvailable(
            transaction,
            principal.workspaceId,
            input.folderId,
            name.normalizedName,
          );
          const created = await transaction.document.create({
            data: {
              workspaceId: principal.workspaceId,
              folderId: input.folderId,
              markdown: input.markdown,
              ...name,
            },
          });
          await this.audit(
            transaction,
            principal,
            "document.create",
            "document",
            created.id,
            requestId,
            { folderId: input.folderId },
          );
          return created;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return this.documentDetailFrom(document, principal.workspaceId);
    } catch (error) {
      this.rethrowMutationError(error);
    }
  }

  public async getDocument(principal: Principal, documentId: string): Promise<DocumentDetail> {
    const document = await this.repository.findVisibleDocument(principal.workspaceId, documentId);
    if (!document) this.throwNotFound("Document");
    return this.documentDetailFrom(document, principal.workspaceId);
  }

  public async updateDocument(
    principal: Principal,
    documentId: string,
    input: UpdateDocumentRequest,
    requestId: string,
  ): Promise<DocumentDetail> {
    const validatedName =
      input.name === undefined ? undefined : this.validateName(input.name, "document");
    try {
      const document = await this.database.client.$transaction(
        async (transaction) => {
          const current = await transaction.document.findFirst({
            where: {
              id: documentId,
              workspaceId: principal.workspaceId,
              state: ResourceState.ACTIVE,
            },
          });
          if (!current) this.throwNotFound("Document");
          const folders = await visibleFolders(transaction, principal.workspaceId);
          if (current.folderId && !folders.some((folder) => folder.id === current.folderId))
            this.throwNotFound("Document");
          this.assertMetadataToken(current.updatedAt, input.expectedUpdatedAt);
          const folderId = input.folderId === undefined ? current.folderId : input.folderId;
          this.assertTargetFolder(folders, folderId);
          const nextName = validatedName ?? {
            name: current.name,
            normalizedName: current.normalizedName,
          };
          await this.assertDocumentNameAvailable(
            transaction,
            principal.workspaceId,
            folderId,
            nextName.normalizedName,
            documentId,
          );
          const updated = await transaction.document.update({
            where: { id: documentId },
            data: { folderId, ...nextName },
          });
          await this.audit(
            transaction,
            principal,
            "document.update",
            "document",
            documentId,
            requestId,
            { folderId },
          );
          return updated;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return this.documentDetailFrom(document, principal.workspaceId);
    } catch (error) {
      this.rethrowMutationError(error);
    }
  }

  public async trashDocument(
    principal: Principal,
    documentId: string,
    requestId: string,
  ): Promise<TrashResult> {
    const trashedAt = new Date();
    await this.database.client.$transaction(async (transaction) => {
      const document = await transaction.document.findFirst({
        where: { id: documentId, workspaceId: principal.workspaceId, state: ResourceState.ACTIVE },
      });
      if (!document) this.throwNotFound("Document");
      const folders = await visibleFolders(transaction, principal.workspaceId);
      if (document.folderId && !folders.some((folder) => folder.id === document.folderId))
        this.throwNotFound("Document");
      await transaction.document.update({
        where: { id: documentId },
        data: {
          state: ResourceState.TRASHED,
          originalFolderId: document.folderId,
          deletedAt: trashedAt,
        },
      });
      await this.audit(transaction, principal, "document.trash", "document", documentId, requestId);
    });
    return { success: true, trashedAt: trashedAt.toISOString() };
  }

  public async bulkDocuments(
    principal: Principal,
    input: BulkDocumentRequest,
    requestId: string,
  ): Promise<BulkDocumentResult> {
    const uniqueIds = [...new Set(input.documentIds)];
    const data: BulkDocumentResult["data"] = [];
    for (const documentId of uniqueIds) {
      try {
        if (input.operation === "TRASH") {
          await this.trashDocument(principal, documentId, requestId);
        } else {
          const current = await this.repository.findVisibleDocument(
            principal.workspaceId,
            documentId,
          );
          if (!current) this.throwNotFound("Document");
          await this.updateDocument(
            principal,
            documentId,
            {
              folderId: input.targetFolderId,
              expectedUpdatedAt: current.updatedAt.toISOString(),
            },
            requestId,
          );
        }
        data.push({ documentId, success: true });
      } catch (error) {
        const coded = error instanceof CodedHttpException ? error : undefined;
        data.push({
          documentId,
          success: false,
          errorCode: coded?.code ?? "INTERNAL_ERROR",
          message: coded?.message ?? "The document was not changed.",
        });
      }
    }
    return { data };
  }

  private async documentDetailFrom(
    document: Parameters<typeof documentSummary>[0],
    workspaceId: string,
  ): Promise<DocumentDetail> {
    const folders = await this.repository.listVisibleFolders(workspaceId);
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    const breadcrumbs: Array<{ id: string; name: string }> = [];
    let cursor = document.folderId ? byId.get(document.folderId) : undefined;
    while (cursor) {
      breadcrumbs.unshift({ id: cursor.id, name: cursor.name });
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
    return {
      ...documentSummary(document),
      markdown: document.markdown,
      breadcrumbs,
      capabilities: { source: true, wysiwyg: false, split: false },
    };
  }

  private validateName(input: string, kind: "folder" | "document") {
    try {
      return this.names.validate(input, kind);
    } catch (error) {
      if (error instanceof InvalidNameError) {
        throw new CodedHttpException(
          "INVALID_NAME",
          "Use a safe, unique name; documents must end in .md.",
          422,
          { reason: error.reason },
        );
      }
      throw error;
    }
  }

  private assertTargetFolder(folders: readonly { id: string }[], folderId: string | null): void {
    if (folderId !== null && !folders.some((folder) => folder.id === folderId))
      this.throwNotFound("Folder");
  }

  private async assertFolderNameAvailable(
    transaction: Prisma.TransactionClient,
    workspaceId: string,
    parentId: string | null,
    normalizedName: string,
    excludeId?: string,
  ): Promise<void> {
    const conflict = await transaction.folder.findFirst({
      where: {
        workspaceId,
        parentId,
        normalizedName,
        state: ResourceState.ACTIVE,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (conflict) this.throwNameConflict();
  }

  private async assertDocumentNameAvailable(
    transaction: Prisma.TransactionClient,
    workspaceId: string,
    folderId: string | null,
    normalizedName: string,
    excludeId?: string,
  ): Promise<void> {
    const conflict = await transaction.document.findFirst({
      where: {
        workspaceId,
        folderId,
        normalizedName,
        state: ResourceState.ACTIVE,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (conflict) this.throwNameConflict();
  }

  private assertMetadataToken(updatedAt: Date, expected: string): void {
    if (updatedAt.getTime() !== new Date(expected).getTime()) {
      throw new CodedHttpException(
        "RESOURCE_STATE_CONFLICT",
        "This item changed elsewhere. Refresh and try again.",
        409,
      );
    }
  }

  private async audit(
    transaction: Prisma.TransactionClient,
    principal: Principal,
    action: string,
    targetType: string,
    targetId: string,
    requestId: string,
    metadata: Prisma.InputJsonValue = {},
  ): Promise<void> {
    await transaction.auditEvent.create({
      data: {
        actorUserId: principal.userId,
        workspaceId: principal.workspaceId,
        action,
        targetType,
        targetId,
        result: "SUCCESS",
        requestId,
        metadata,
      },
    });
  }

  private rethrowMutationError(error: unknown): never {
    if (error instanceof CodedHttpException) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
      this.throwNameConflict();
    throw error;
  }

  private throwNotFound(resource: string): never {
    throw new CodedHttpException("NOT_FOUND", `${resource} not found.`, 404);
  }

  private throwNameConflict(): never {
    throw new CodedHttpException(
      "NAME_CONFLICT",
      "An active item with the same normalized name already exists here.",
      409,
    );
  }

  private throwDepthLimit(): never {
    throw new CodedHttpException(
      "LIMIT_EXCEEDED",
      "The folder move would exceed the workspace depth limit.",
      422,
    );
  }
}

function folderDto(folder: {
  id: string;
  parentId: string | null;
  name: string;
  state: "ACTIVE" | "TRASHED" | "DELETING";
  createdAt: Date;
  updatedAt: Date;
}): Folder {
  return {
    id: folder.id,
    parentId: folder.parentId,
    name: folder.name,
    state: folder.state,
    createdAt: folder.createdAt.toISOString(),
    updatedAt: folder.updatedAt.toISOString(),
  };
}

function documentSummary(document: {
  id: string;
  folderId: string | null;
  name: string;
  revision: number;
  markdown: string;
  createdAt: Date;
  updatedAt: Date;
}): DocumentSummary {
  return {
    id: document.id,
    folderId: document.folderId,
    name: document.name,
    revision: document.revision,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}
