export interface HierarchyFolder {
  readonly id: string;
  readonly parentId: string | null;
}

export interface HierarchyAnalysis {
  readonly depthById: ReadonlyMap<string, number>;
  readonly descendantsById: ReadonlyMap<string, ReadonlySet<string>>;
}

export class InvalidHierarchyError extends Error {
  public constructor(public readonly reason: "cycle" | "orphan" | "depth") {
    super(`Invalid folder hierarchy: ${reason}`);
    this.name = "InvalidHierarchyError";
  }
}

export function analyzeHierarchy(folders: readonly HierarchyFolder[]): HierarchyAnalysis {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const depthById = new Map<string, number>();
  const children = new Map<string | null, string[]>();
  for (const folder of folders) {
    if (folder.parentId !== null && !byId.has(folder.parentId)) {
      throw new InvalidHierarchyError("orphan");
    }
    const siblings = children.get(folder.parentId) ?? [];
    siblings.push(folder.id);
    children.set(folder.parentId, siblings);
  }

  const visiting = new Set<string>();
  const resolveDepth = (id: string): number => {
    const known = depthById.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) throw new InvalidHierarchyError("cycle");
    visiting.add(id);
    const folder = byId.get(id);
    if (!folder) throw new InvalidHierarchyError("orphan");
    const depth = folder.parentId === null ? 1 : resolveDepth(folder.parentId) + 1;
    visiting.delete(id);
    depthById.set(id, depth);
    return depth;
  };
  for (const folder of folders) resolveDepth(folder.id);

  const descendantsById = new Map<string, ReadonlySet<string>>();
  const resolveDescendants = (id: string): ReadonlySet<string> => {
    const known = descendantsById.get(id);
    if (known) return known;
    const descendants = new Set<string>();
    for (const child of children.get(id) ?? []) {
      descendants.add(child);
      for (const descendant of resolveDescendants(child)) descendants.add(descendant);
    }
    descendantsById.set(id, descendants);
    return descendants;
  };
  for (const folder of folders) resolveDescendants(folder.id);
  return { depthById, descendantsById };
}

export function assertFolderMove(
  analysis: HierarchyAnalysis,
  folderId: string,
  targetParentId: string | null,
  maxDepth: number,
): void {
  if (
    targetParentId === folderId ||
    (targetParentId !== null && analysis.descendantsById.get(folderId)?.has(targetParentId))
  ) {
    throw new InvalidHierarchyError("cycle");
  }
  const targetDepth = targetParentId === null ? 0 : analysis.depthById.get(targetParentId);
  if (targetDepth === undefined) throw new InvalidHierarchyError("orphan");
  const folderDepth = analysis.depthById.get(folderId);
  if (folderDepth === undefined) throw new InvalidHierarchyError("orphan");
  let subtreeHeight = 1;
  for (const descendant of analysis.descendantsById.get(folderId) ?? []) {
    const depth = analysis.depthById.get(descendant);
    if (depth !== undefined) subtreeHeight = Math.max(subtreeHeight, depth - folderDepth + 1);
  }
  if (targetDepth + subtreeHeight > maxDepth) throw new InvalidHierarchyError("depth");
}
