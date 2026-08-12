export interface EmergencyDraft {
  readonly schemaVersion: 1;
  readonly documentId: string;
  readonly baseRevision: number;
  readonly markdown: string;
  readonly updatedAt: string;
}

const DATABASE_NAME = "markora-emergency-drafts";
const STORE_NAME = "drafts";
const DATABASE_VERSION = 1;

export function createEmergencyDraft(
  documentId: string,
  baseRevision: number,
  markdown: string,
  now = new Date(),
): EmergencyDraft {
  return {
    schemaVersion: 1,
    documentId,
    baseRevision,
    markdown,
    updatedAt: now.toISOString(),
  };
}

export async function readEmergencyDraft(documentId: string): Promise<EmergencyDraft | null> {
  const database = await openDraftDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(documentId);
    request.onsuccess = () => resolve(isEmergencyDraft(request.result) ? request.result : null);
    request.onerror = () =>
      reject(request.error ?? new Error("The local draft could not be read."));
    transaction.oncomplete = () => database.close();
  });
}

export async function writeEmergencyDraft(draft: EmergencyDraft): Promise<void> {
  const database = await openDraftDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(draft);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("The local draft failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("The local draft failed."));
  });
  database.close();
}

export async function deleteEmergencyDraftIfMatching(
  documentId: string,
  acknowledgedMarkdown: string,
): Promise<boolean> {
  const database = await openDraftDatabase();
  const deleted = await new Promise<boolean>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    let matched = false;
    const request = store.get(documentId);
    request.onsuccess = () => {
      const draft = request.result;
      if (isEmergencyDraft(draft) && draft.markdown === acknowledgedMarkdown) {
        matched = true;
        store.delete(documentId);
      }
    };
    transaction.oncomplete = () => resolve(matched);
    transaction.onerror = () => reject(transaction.error ?? new Error("The local draft failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("The local draft failed."));
  });
  database.close();
  return deleted;
}

export async function discardEmergencyDraft(documentId: string): Promise<void> {
  const database = await openDraftDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(documentId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("The local draft failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("The local draft failed."));
  });
  database.close();
}

function openDraftDatabase(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB) return Promise.reject(new Error("IndexedDB is unavailable."));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "documentId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB could not be opened."));
    request.onblocked = () => reject(new Error("IndexedDB upgrade is blocked."));
  });
}

function isEmergencyDraft(value: unknown): value is EmergencyDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<EmergencyDraft>;
  return (
    draft.schemaVersion === 1 &&
    typeof draft.documentId === "string" &&
    Number.isInteger(draft.baseRevision) &&
    typeof draft.markdown === "string" &&
    typeof draft.updatedAt === "string"
  );
}
