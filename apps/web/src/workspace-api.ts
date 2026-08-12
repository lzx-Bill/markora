import {
  ApiErrorSchema,
  type BackgroundJob,
  BackgroundJobSchema,
  type BulkDocumentResult,
  BulkDocumentResultSchema,
  type DocumentDetail,
  DocumentDetailSchema,
  type DocumentList,
  DocumentListSchema,
  type DocumentVersionDetail,
  DocumentVersionDetailSchema,
  type DocumentVersionList,
  DocumentVersionListSchema,
  type Folder,
  FolderSchema,
  type FolderTree,
  FolderTreeSchema,
  type PermanentDeleteResult,
  PermanentDeleteResultSchema,
  type QuickOpenResult,
  QuickOpenResultSchema,
  type RestoreDocumentVersionResult,
  RestoreDocumentVersionResultSchema,
  type RestoreResourceResult,
  RestoreResourceResultSchema,
  type SaveDocumentContentResult,
  SaveDocumentContentResultSchema,
  type SearchResultPage,
  SearchResultPageSchema,
  type TrashList,
  TrashListSchema,
} from "@markora/contracts";

export class WorkspaceApiError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly requestId?: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "WorkspaceApiError";
  }
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`/api/v1${path}`, {
    credentials: "same-origin",
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    const parsed = ApiErrorSchema.safeParse(body);
    throw new WorkspaceApiError(
      parsed.success ? parsed.data.error.code : "UNKNOWN",
      parsed.success ? parsed.data.error.message : "The request could not be completed.",
      parsed.success ? parsed.data.error.requestId : undefined,
      parsed.success ? parsed.data.error.details : undefined,
    );
  }
  return body;
}

export async function getFolderTree(): Promise<FolderTree> {
  return FolderTreeSchema.parse(await request("/folders/tree"));
}

export async function createFolder(parentId: string | null, name: string): Promise<Folder> {
  return FolderSchema.parse(
    await request("/folders", { method: "POST", body: JSON.stringify({ parentId, name }) }),
  );
}

export async function updateFolder(
  id: string,
  input: { name?: string; parentId?: string | null; expectedUpdatedAt: string },
): Promise<Folder> {
  return FolderSchema.parse(
    await request(`/folders/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  );
}

export async function trashFolder(id: string): Promise<void> {
  await request(`/folders/${id}/trash`, { method: "POST" });
}

export async function getDocuments(folderId: string | null): Promise<DocumentList> {
  const value = folderId ?? "root";
  return DocumentListSchema.parse(
    await request(`/documents?folderId=${encodeURIComponent(value)}`),
  );
}

export async function getDocument(id: string): Promise<DocumentDetail> {
  return DocumentDetailSchema.parse(await request(`/documents/${id}`));
}

export async function createDocument(
  folderId: string | null,
  name: string,
  markdown = "",
): Promise<DocumentDetail> {
  return DocumentDetailSchema.parse(
    await request("/documents", {
      method: "POST",
      body: JSON.stringify({ folderId, name, markdown }),
    }),
  );
}

export async function updateDocument(
  id: string,
  input: { name?: string; folderId?: string | null; expectedUpdatedAt: string },
): Promise<DocumentDetail> {
  return DocumentDetailSchema.parse(
    await request(`/documents/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  );
}

export async function saveDocumentContent(
  id: string,
  input: {
    markdown: string;
    baseRevision: number;
    clientMutationId: string;
    conflictResolution?: "OVERWRITE_SERVER";
  },
): Promise<SaveDocumentContentResult> {
  return SaveDocumentContentResultSchema.parse(
    await request(`/documents/${id}/content`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  );
}

export async function trashDocument(id: string): Promise<void> {
  await request(`/documents/${id}/trash`, { method: "POST" });
}

export async function bulkDocuments(input: {
  operation: "MOVE" | "TRASH";
  documentIds: string[];
  targetFolderId?: string | null;
}): Promise<BulkDocumentResult> {
  return BulkDocumentResultSchema.parse(
    await request("/documents/bulk", { method: "POST", body: JSON.stringify(input) }),
  );
}

export async function getDocumentVersions(id: string): Promise<DocumentVersionList> {
  return DocumentVersionListSchema.parse(await request(`/documents/${id}/versions`));
}

export async function getDocumentVersion(
  documentId: string,
  versionId: string,
): Promise<DocumentVersionDetail> {
  return DocumentVersionDetailSchema.parse(
    await request(`/documents/${documentId}/versions/${versionId}`),
  );
}

export async function restoreDocumentVersion(
  documentId: string,
  versionId: string,
  baseRevision: number,
): Promise<RestoreDocumentVersionResult> {
  return RestoreDocumentVersionResultSchema.parse(
    await request(`/documents/${documentId}/versions/${versionId}/restore`, {
      method: "POST",
      body: JSON.stringify({ baseRevision }),
    }),
  );
}

export async function getTrash(): Promise<TrashList> {
  return TrashListSchema.parse(await request("/trash"));
}

export async function restoreTrashItem(
  type: "FOLDER" | "DOCUMENT",
  id: string,
  targetParentId: string | null | undefined,
  conflictStrategy: "FAIL" | "KEEP_BOTH",
): Promise<RestoreResourceResult> {
  const target = type === "FOLDER" ? "folders" : "documents";
  return RestoreResourceResultSchema.parse(
    await request(`/${target}/${id}/restore`, {
      method: "POST",
      body: JSON.stringify({
        ...(targetParentId !== undefined ? { targetParentId } : {}),
        conflictStrategy,
      }),
    }),
  );
}

export async function permanentlyDeleteTrashItem(
  type: "FOLDER" | "DOCUMENT",
  id: string,
): Promise<PermanentDeleteResult> {
  const target = type === "FOLDER" ? "folders" : "documents";
  return PermanentDeleteResultSchema.parse(await request(`/${target}/${id}`, { method: "DELETE" }));
}

export async function getJob(id: string): Promise<BackgroundJob> {
  return BackgroundJobSchema.parse(await request(`/jobs/${id}`));
}

export async function searchDocuments(input: {
  q: string;
  scope: "all" | "folder" | "subtree";
  folderId?: string;
  includeCodeBlocks: boolean;
  cursor?: string;
}): Promise<SearchResultPage> {
  const query = new URLSearchParams({
    q: input.q,
    scope: input.scope,
    includeCodeBlocks: String(input.includeCodeBlocks),
  });
  if (input.folderId) query.set("folderId", input.folderId);
  if (input.cursor) query.set("cursor", input.cursor);
  return SearchResultPageSchema.parse(await request(`/search?${query.toString()}`));
}

export async function quickOpenDocuments(q: string): Promise<QuickOpenResult> {
  const query = new URLSearchParams({ q });
  return QuickOpenResultSchema.parse(await request(`/quick-open?${query.toString()}`));
}
