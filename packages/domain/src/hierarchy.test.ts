import { describe, expect, it } from "vitest";
import { analyzeHierarchy, assertFolderMove, InvalidHierarchyError } from "./hierarchy.js";

describe("folder hierarchy policy", () => {
  const folders = [
    { id: "a", parentId: null },
    { id: "b", parentId: "a" },
    { id: "c", parentId: "b" },
  ];

  it("rejects moving a folder into itself or a descendant", () => {
    const analysis = analyzeHierarchy(folders);
    expect(() => assertFolderMove(analysis, "a", "a", 32)).toThrow(InvalidHierarchyError);
    expect(() => assertFolderMove(analysis, "a", "c", 32)).toThrow(InvalidHierarchyError);
  });

  it("enforces maximum depth including the moved subtree", () => {
    const analysis = analyzeHierarchy(folders);
    expect(() => assertFolderMove(analysis, "b", null, 2)).not.toThrow();
    expect(() => assertFolderMove(analysis, "a", null, 2)).toThrow(InvalidHierarchyError);
  });

  it("analyzes ten thousand nodes without recursion overflow", () => {
    const wide = Array.from({ length: 10_000 }, (_, index) => ({
      id: String(index),
      parentId: index === 0 ? null : "0",
    }));
    const startedAt = performance.now();
    const analysis = analyzeHierarchy(wide);
    expect(analysis.depthById.size).toBe(10_000);
    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });
});
