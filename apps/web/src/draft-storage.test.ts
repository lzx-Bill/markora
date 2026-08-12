import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import {
  createEmergencyDraft,
  deleteEmergencyDraftIfMatching,
  discardEmergencyDraft,
  readEmergencyDraft,
  writeEmergencyDraft,
} from "./draft-storage.js";

describe("emergency draft storage", () => {
  it("keeps a versioned draft until the matching Markdown is acknowledged", async () => {
    const id = crypto.randomUUID();
    const draft = createEmergencyDraft(id, 3, "local unsynced", new Date("2026-08-12T10:00:00Z"));
    await writeEmergencyDraft(draft);
    expect(await readEmergencyDraft(id)).toEqual(draft);
    expect(await deleteEmergencyDraftIfMatching(id, "different server value")).toBe(false);
    expect(await readEmergencyDraft(id)).toEqual(draft);
    expect(await deleteEmergencyDraftIfMatching(id, draft.markdown)).toBe(true);
    expect(await readEmergencyDraft(id)).toBeNull();
  });

  it("discards only the requested document draft", async () => {
    const first = createEmergencyDraft(crypto.randomUUID(), 1, "first");
    const second = createEmergencyDraft(crypto.randomUUID(), 1, "second");
    await writeEmergencyDraft(first);
    await writeEmergencyDraft(second);
    await discardEmergencyDraft(first.documentId);
    expect(await readEmergencyDraft(first.documentId)).toBeNull();
    expect(await readEmergencyDraft(second.documentId)).toEqual(second);
    await discardEmergencyDraft(second.documentId);
  });
});
