import {
  ApiErrorSchema,
  type BulkDocumentResult,
  BulkDocumentResultSchema,
  type DocumentDetail,
  DocumentDetailSchema,
  type DocumentList,
  DocumentListSchema,
  type Folder,
  FolderSchema,
  type FolderTree,
  FolderTreeSchema,
} from "@markora/contracts";

export class WorkspaceApiError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly requestId?: string,
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
