import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { afterEach, describe, expect, it } from "vitest";
import yauzl from "yauzl";
import yazl from "yazl";
import {
  extractMarkdownZip,
  portableArchiveComponent,
  registerMarkdownFile,
  UnsafeArchiveError,
  uniqueArchivePath,
  validateArchivePath,
  writeMarkdownZip,
} from "./index.js";

const roots: string[] = [];
const limits = {
  maxFiles: 20,
  maxTotalBytes: 1024 * 1024,
  maxEntryBytes: 256 * 1024,
  maxCompressionRatio: 1000,
  maxDepth: 8,
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("portable Markdown archives", () => {
  it("rejects traversal, absolute, backslash and excessive-depth paths", () => {
    expect(() => validateArchivePath("../private.md", 8)).toThrowError(UnsafeArchiveError);
    expect(() => validateArchivePath("/absolute.md", 8)).toThrowError(UnsafeArchiveError);
    expect(() => validateArchivePath("folder\\..\\private.md", 8)).toThrowError(UnsafeArchiveError);
    expect(() => validateArchivePath("a/b/c.md", 2)).toThrowError(UnsafeArchiveError);
  });

  it("normalizes platform-unsafe names and resolves collisions", () => {
    expect(portableArchiveComponent("A:B.md", "document.md")).toEqual({
      name: "A_B.md",
      normalized: true,
    });
    expect(portableArchiveComponent("CON.md", "document.md").name).toBe("_CON.md");
    const used = new Set<string>();
    expect(uniqueArchivePath("Notes/A.md", used)).toBe("Notes/A.md");
    expect(uniqueArchivePath("notes/a.md", used)).toBe("notes/a (2).md");
  });

  it("extracts only valid UTF-8 Markdown and reports ignored files", async () => {
    const root = await tempRoot();
    const archive = join(root, "input.zip");
    await createZip(archive, [
      { name: "Notes/Hello.md", bytes: Buffer.from("# Hello\r\n原始 Markdown", "utf8") },
      { name: "Notes/image.png", bytes: Buffer.from([1, 2, 3]) },
    ]);
    const result = await extractMarkdownZip(archive, join(root, "extract"), limits);
    expect(result.ignoredCount).toBe(1);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.relativePath).toBe("Notes/Hello.md");
    expect(await readFile(result.entries[0]?.storagePath ?? "", "utf8")).toBe(
      "# Hello\r\n原始 Markdown",
    );
  });

  it("rejects invalid UTF-8 and unsafe compression ratios", async () => {
    const root = await tempRoot();
    const invalid = join(root, "invalid.md");
    await writeFile(invalid, Buffer.from([0xff, 0xfe]), { mode: 0o600 });
    await expect(registerMarkdownFile(invalid, "invalid.md", limits)).rejects.toMatchObject({
      reason: "invalid_encoding",
    });

    const archive = join(root, "ratio.zip");
    await createZip(archive, [{ name: "bomb.md", bytes: Buffer.alloc(50_000, 0x61) }]);
    await expect(
      extractMarkdownZip(archive, join(root, "ratio"), { ...limits, maxCompressionRatio: 2 }),
    ).rejects.toMatchObject({ reason: "compression_ratio" });
  });

  it("rejects duplicate normalized entries, links, count and size limit violations", async () => {
    const root = await tempRoot();
    const duplicate = join(root, "duplicate.zip");
    await createZip(duplicate, [
      { name: "Résumé.md", bytes: Buffer.from("one") },
      { name: "RÉSUMÉ.md", bytes: Buffer.from("two") },
    ]);
    await expect(
      extractMarkdownZip(duplicate, join(root, "duplicate"), limits),
    ).rejects.toMatchObject({
      reason: "duplicate_path",
    });

    const linked = join(root, "link.zip");
    await createZip(linked, [{ name: "link.md", bytes: Buffer.from("target"), mode: 0o120777 }]);
    await expect(extractMarkdownZip(linked, join(root, "linked"), limits)).rejects.toMatchObject({
      reason: "symlink",
    });

    const counted = join(root, "count.zip");
    await createZip(counted, [
      { name: "one.md", bytes: Buffer.from("one") },
      { name: "two.md", bytes: Buffer.from("two") },
    ]);
    await expect(
      extractMarkdownZip(counted, join(root, "counted"), { ...limits, maxFiles: 1 }),
    ).rejects.toMatchObject({ reason: "file_count" });
    await expect(
      extractMarkdownZip(counted, join(root, "entry-size"), { ...limits, maxEntryBytes: 2 }),
    ).rejects.toMatchObject({ reason: "entry_size" });
    await expect(
      extractMarkdownZip(counted, join(root, "total-size"), { ...limits, maxTotalBytes: 5 }),
    ).rejects.toMatchObject({ reason: "total_size" });
  });

  it("writes exact raw Markdown without internal metadata", async () => {
    const root = await tempRoot();
    const archive = join(root, "export.zip");
    const markdown = "---\r\nraw: yes\r\n---\r\n<script>source only</script>";
    await writeMarkdownZip([{ archivePath: "Folder/Exact.md", markdown }], archive);
    const entries = await readZip(archive);
    expect(entries).toEqual(new Map([["Folder/Exact.md", markdown]]));
    expect([...entries.keys()].join(" ")).not.toMatch(/id|manifest/iu);
  });
});

async function tempRoot(): Promise<string> {
  const root = join(process.cwd(), "tmp", `portability-${randomUUID()}`);
  roots.push(root);
  await mkdir(root, { recursive: true, mode: 0o700 });
  return root;
}

async function createZip(
  path: string,
  entries: readonly { name: string; bytes: Buffer; mode?: number }[],
): Promise<void> {
  const zip = new yazl.ZipFile();
  const completed = pipeline(zip.outputStream, createWriteStream(path));
  for (const entry of entries) {
    zip.addBuffer(
      entry.bytes,
      entry.name,
      entry.mode === undefined ? undefined : { mode: entry.mode },
    );
  }
  zip.end();
  await completed;
}

async function readZip(path: string): Promise<Map<string, string>> {
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true }, (error, opened) => {
      if (error || !opened) reject(error ?? new Error("Could not read test ZIP."));
      else resolve(opened);
    });
  });
  const output = new Map<string, string>();
  await new Promise<void>((resolve, reject) => {
    zip.on("entry", (entry) => {
      zip.openReadStream(entry, (error, stream) => {
        if (error || !stream) {
          reject(error ?? new Error("Could not read test entry."));
          return;
        }
        const chunks: Buffer[] = [];
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("end", () => {
          output.set(entry.fileName, Buffer.concat(chunks).toString("utf8"));
          zip.readEntry();
        });
        stream.on("error", reject);
      });
    });
    zip.on("end", resolve);
    zip.on("error", reject);
    zip.readEntry();
  });
  return output;
}
