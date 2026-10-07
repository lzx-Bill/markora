import { describe, expect, it, vi } from "vitest";
import { ContentRepository } from "./content.repository.js";

function createRepository(folderRows: { id: string; parentId: string | null }[] = []) {
  const folderFindMany = vi.fn().mockResolvedValue(folderRows);
  const documentFindMany = vi.fn().mockResolvedValue([]);
  const repository = new ContentRepository();
  Object.defineProperty(repository, "database", {
    value: {
      client: {
        folder: { findMany: folderFindMany },
        document: { findMany: documentFindMany },
      },
    },
  });
  return { repository, folderFindMany, documentFindMany };
}

describe("ContentRepository.listDocuments", () => {
  it("projects only summary fields for root documents without loading folders", async () => {
    const { repository, folderFindMany, documentFindMany } = createRepository();

    const result = await repository.listDocuments("workspace-id", null);

    expect(result).toEqual({ folderVisible: true, documents: [] });
    expect(folderFindMany).not.toHaveBeenCalled();
    expect(documentFindMany).toHaveBeenCalledWith({
      where: { workspaceId: "workspace-id", folderId: null, state: "ACTIVE" },
      orderBy: [{ updatedAt: "desc" }, { normalizedName: "asc" }],
      select: {
        id: true,
        folderId: true,
        name: true,
        revision: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  });

  it("checks nested folder reachability once before listing its documents", async () => {
    const { repository, folderFindMany, documentFindMany } = createRepository([
      { id: "root-folder", parentId: null },
      { id: "child-folder", parentId: "root-folder" },
      { id: "orphan-folder", parentId: "missing-parent" },
    ]);

    const result = await repository.listDocuments("workspace-id", "child-folder");

    expect(result.folderVisible).toBe(true);
    expect(folderFindMany).toHaveBeenCalledTimes(1);
    expect(folderFindMany).toHaveBeenCalledWith({
      where: { workspaceId: "workspace-id", state: "ACTIVE" },
      select: { id: true, parentId: true },
    });
    expect(documentFindMany).toHaveBeenCalledTimes(1);
    expect(documentFindMany.mock.calls[0]?.[0]).toMatchObject({
      where: { workspaceId: "workspace-id", folderId: "child-folder", state: "ACTIVE" },
    });
    expect(documentFindMany.mock.calls[0]?.[0]).not.toHaveProperty("include");
  });

  it("does not list documents from an unreachable folder", async () => {
    const { repository, documentFindMany } = createRepository([
      { id: "orphan-folder", parentId: "missing-parent" },
    ]);

    const result = await repository.listDocuments("workspace-id", "orphan-folder");

    expect(result).toEqual({ folderVisible: false, documents: [] });
    expect(documentFindMany).not.toHaveBeenCalled();
  });
});
