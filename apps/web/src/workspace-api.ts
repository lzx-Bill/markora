import {
  type AcceptedJob,
  AcceptedJobSchema,
  ApiErrorSchema,
  type BackgroundJob,
  BackgroundJobSchema,
  type BulkDocumentResult,
  BulkDocumentResultSchema,
  type CreateExportResult,
  CreateExportResultSchema,
  type DocumentDetail,
  DocumentDetailSchema,
  type DocumentList,
  DocumentListSchema,
  type DocumentVersionDetail,
  DocumentVersionDetailSchema,
  type DocumentVersionList,
  DocumentVersionListSchema,
  type ExportRequest,
  type Folder,
  FolderSchema,
  type FolderTree,
  FolderTreeSchema,
  type ImportPreviewResult,
  ImportPreviewResultSchema,
  type ImportUploadResult,
  ImportUploadResultSchema,
  type JobItemPage,
  JobItemPageSchema,
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

export { request as apiRequest };

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

export async function uploadImport(files: readonly File[]): Promise<ImportUploadResult> {
  const form = new FormData();
  form.append(
    "relativePaths",
    JSON.stringify(files.map((file) => file.webkitRelativePath || file.name)),
  );
  for (const file of files) form.append("files", file, file.name);
  return ImportUploadResultSchema.parse(
    await formRequest("/imports/uploads", { method: "POST", body: form }),
  );
}

export async function previewImport(
  uploadToken: string,
  targetFolderId: string | null,
): Promise<ImportPreviewResult> {
  return ImportPreviewResultSchema.parse(
    await request("/imports/preview", {
      method: "POST",
      body: JSON.stringify({ uploadToken, targetFolderId }),
    }),
  );
}

export async function executeImport(
  planId: string,
  input: {
    idempotencyKey: string;
    conflictStrategy: "KEEP_BOTH" | "SKIP" | "REPLACE";
    overrides: { sourceKey: string; strategy: "KEEP_BOTH" | "SKIP" | "REPLACE" }[];
  },
): Promise<AcceptedJob> {
  return AcceptedJobSchema.parse(
    await request(`/imports/${planId}/execute`, { method: "POST", body: JSON.stringify(input) }),
  );
}

export async function getJobItems(id: string): Promise<JobItemPage> {
  return JobItemPageSchema.parse(await request(`/jobs/${id}/items`));
}

export async function cancelJob(id: string): Promise<AcceptedJob> {
  return AcceptedJobSchema.parse(await request(`/jobs/${id}/cancel`, { method: "POST" }));
}

export async function retryFailedJob(id: string): Promise<AcceptedJob> {
  return AcceptedJobSchema.parse(await request(`/jobs/${id}/retry-failed`, { method: "POST" }));
}

export async function createExport(input: ExportRequest): Promise<CreateExportResult> {
  return CreateExportResultSchema.parse(
    await request("/exports", { method: "POST", body: JSON.stringify(input) }),
  );
}

export async function downloadDocumentSource(id: string): Promise<void> {
  await download(`/documents/${id}/download`, "document.md");
}

export async function downloadExport(jobId: string, token: string): Promise<void> {
  await download(
    `/exports/${jobId}/download?${new URLSearchParams({ token }).toString()}`,
    "markora-export.zip",
  );
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

async function formRequest(path: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(`/api/v1${path}`, { credentials: "same-origin", ...init });
  const body: unknown = await response.json();
  if (!response.ok) throwApiError(body);
  return body;
}

async function download(path: string, fallbackName: string): Promise<void> {
  const response = await fetch(`/api/v1${path}`, { credentials: "same-origin" });
  if (!response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    throwApiError(body);
  }
  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") ?? "";
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/iu)?.[1];
  const name = encoded ? decodeURIComponent(encoded) : fallbackName;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function throwApiError(body: unknown): never {
  const parsed = ApiErrorSchema.safeParse(body);
  throw new WorkspaceApiError(
    parsed.success ? parsed.data.error.code : "UNKNOWN",
    parsed.success ? parsed.data.error.message : "The request could not be completed.",
    parsed.success ? parsed.data.error.requestId : undefined,
    parsed.success ? parsed.data.error.details : undefined,
  );
}
