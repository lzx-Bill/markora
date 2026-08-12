import { resolve, sep } from "node:path";

export class UnsafeArchiveError extends Error {
  public constructor(
    public readonly reason:
      | "absolute_path"
      | "backslash_path"
      | "duplicate_path"
      | "invalid_path"
      | "path_traversal"
      | "symlink"
      | "encrypted"
      | "file_count"
      | "entry_size"
      | "total_size"
      | "compression_ratio"
      | "invalid_encoding",
    message: string,
  ) {
    super(message);
    this.name = "UnsafeArchiveError";
  }
}

export function validateArchivePath(input: string, maxDepth: number): string {
  if (input.includes("\\")) {
    throw new UnsafeArchiveError("backslash_path", "Archive paths cannot contain backslashes.");
  }
  if (input.startsWith("/") || /^[a-z]:/iu.test(input)) {
    throw new UnsafeArchiveError("absolute_path", "Archive paths must be relative.");
  }
  if (input.includes("\0") || input.includes("\uFFFD")) {
    throw new UnsafeArchiveError("invalid_path", "Archive path encoding is invalid.");
  }
  const directory = input.endsWith("/");
  const segments = input
    .split("/")
    .filter((_segment, index, all) => !(directory && index === all.length - 1));
  if (
    segments.length === 0 ||
    segments.some((segment) => segment.length === 0 || segment === ".")
  ) {
    throw new UnsafeArchiveError("invalid_path", "Archive path contains an empty or dot segment.");
  }
  if (segments.some((segment) => segment === "..")) {
    throw new UnsafeArchiveError("path_traversal", "Archive path traversal is not allowed.");
  }
  if (segments.length > maxDepth) {
    throw new UnsafeArchiveError("invalid_path", "Archive path exceeds the configured depth.");
  }
  return `${segments.map((segment) => segment.normalize("NFC")).join("/")}${directory ? "/" : ""}`;
}

export function privatePath(root: string, ...safeSegments: string[]): string {
  if (safeSegments.some((segment) => !/^[a-zA-Z0-9_-]+$/u.test(segment))) {
    throw new Error("Temporary path contains an unsafe server-generated segment.");
  }
  const resolvedRoot = resolve(root);
  const candidate = resolve(resolvedRoot, ...safeSegments);
  if (candidate !== resolvedRoot && !candidate.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error("Temporary path escaped its configured root.");
  }
  return candidate;
}

const windowsReserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;

export function portableArchiveComponent(
  input: string,
  fallback: string,
): {
  name: string;
  normalized: boolean;
} {
  const source = input.normalize("NFC");
  let name = [...source]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f || '<>:"/\\|?*'.includes(character)
        ? "_"
        : character;
    })
    .join("")
    .replace(/[. ]+$/u, "")
    .trim();
  if (name.length === 0) name = fallback;
  if (windowsReserved.test(name)) name = `_${name}`;
  return { name, normalized: name !== source };
}

export function uniqueArchivePath(path: string, used: Set<string>): string {
  const folded = path.normalize("NFC").toLocaleLowerCase();
  if (!used.has(folded)) {
    used.add(folded);
    return path;
  }
  const slash = path.lastIndexOf("/");
  const directory = slash >= 0 ? path.slice(0, slash + 1) : "";
  const leaf = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = leaf.toLocaleLowerCase().endsWith(".md") ? leaf.length - 3 : leaf.length;
  const base = leaf.slice(0, dot);
  const extension = leaf.slice(dot);
  for (let suffix = 2; suffix < 100_000; suffix += 1) {
    const candidate = `${directory}${base} (${suffix})${extension}`;
    const candidateFolded = candidate.normalize("NFC").toLocaleLowerCase();
    if (!used.has(candidateFolded)) {
      used.add(candidateFolded);
      return candidate;
    }
  }
  throw new Error("Could not allocate a collision-free archive path.");
}
