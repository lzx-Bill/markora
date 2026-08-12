import type { Document, Folder, Prisma } from "@markora/database";
import { ResourceState } from "@markora/database";
import { Inject, Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service.js";

type ReadClient = Pick<Prisma.TransactionClient, "folder" | "document" | "workspace">;

export async function visibleFolders(client: ReadClient, workspaceId: string): Promise<Folder[]> {
  const folders = await client.folder.findMany({
    where: { workspaceId, state: ResourceState.ACTIVE },
    orderBy: [{ normalizedName: "asc" }, { id: "asc" }],
  });
  const children = new Map<string | null, Folder[]>();
  for (const folder of folders) {
    const siblings = children.get(folder.parentId) ?? [];
    siblings.push(folder);
    children.set(folder.parentId, siblings);
  }
  const reachable: Folder[] = [];
  const queue = [...(children.get(null) ?? [])];
  for (let index = 0; index < queue.length; index += 1) {
    const folder = queue[index];
    if (!folder) continue;
    reachable.push(folder);
    queue.push(...(children.get(folder.id) ?? []));
  }
  return reachable;
}

@Injectable()
export class ContentRepository {
  @Inject(DatabaseService)
  private readonly database!: DatabaseService;

  public listVisibleFolders(workspaceId: string): Promise<Folder[]> {
    return visibleFolders(this.database.client, workspaceId);
  }

  public async findVisibleFolder(workspaceId: string, folderId: string): Promise<Folder | null> {
    return (
      (await this.listVisibleFolders(workspaceId)).find((folder) => folder.id === folderId) ?? null
    );
  }

  public async listDocuments(workspaceId: string, folderId: string | null): Promise<Document[]> {
    if (folderId !== null && !(await this.findVisibleFolder(workspaceId, folderId))) return [];
    return this.database.client.document.findMany({
      where: { workspaceId, folderId, state: ResourceState.ACTIVE },
      orderBy: [{ updatedAt: "desc" }, { normalizedName: "asc" }],
    });
  }

  public async findVisibleDocument(
    workspaceId: string,
    documentId: string,
  ): Promise<Document | null> {
    const document = await this.database.client.document.findFirst({
      where: { id: documentId, workspaceId, state: ResourceState.ACTIVE },
    });
    if (!document) return null;
    if (document.folderId && !(await this.findVisibleFolder(workspaceId, document.folderId))) {
      return null;
    }
    return document;
  }
}
