import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import yauzl, { type Entry, type ZipFile } from "yauzl";
import yazl from "yazl";
import { UnsafeArchiveError, validateArchivePath } from "./paths.js";

export interface ArchiveLimits {
  readonly maxFiles: number;
  readonly maxTotalBytes: number;
  readonly maxEntryBytes: number;
  readonly maxCompressionRatio: number;
  readonly maxDepth: number;
}

export interface ExtractedMarkdown {
  readonly sourceKey: string;
  readonly relativePath: string;
  readonly storagePath: string;
  readonly sha256: string;
  readonly bytes: number;
}

export interface ExtractedArchive {
  readonly entries: readonly ExtractedMarkdown[];
  readonly ignoredCount: number;
  readonly totalUncompressedBytes: number;
}

export interface ZipMarkdownItem {
  readonly archivePath: string;
  readonly markdown: string;
}

export async function extractMarkdownZip(
  zipPath: string,
  outputDirectory: string,
  limits: ArchiveLimits,
): Promise<ExtractedArchive> {
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  const zip = await openZip(zipPath);
  const seen = new Set<string>();
  const extracted: ExtractedMarkdown[] = [];
  let ignoredCount = 0;
  let entryCount = 0;
  let totalUncompressedBytes = 0;
  try {
    while (true) {
      const entry = await nextEntry(zip);
      if (!entry) break;
      entryCount += 1;
      if (entryCount > limits.maxFiles) {
        throw new UnsafeArchiveError("file_count", "Archive contains too many entries.");
      }
      const path = validateArchivePath(entry.fileName, limits.maxDepth);
      const folded = path.normalize("NFC").toLocaleLowerCase();
      if (seen.has(folded)) {
        throw new UnsafeArchiveError("duplicate_path", "Archive contains duplicate paths.");
      }
      seen.add(folded);
      validateEntryType(entry);
      if (path.endsWith("/")) continue;
      if ((entry.generalPurposeBitFlag & 0x1) !== 0) {
        throw new UnsafeArchiveError("encrypted", "Encrypted archive entries are not supported.");
      }
      if (entry.uncompressedSize > limits.maxEntryBytes) {
        throw new UnsafeArchiveError(
          "entry_size",
          "Archive entry exceeds the Markdown size limit.",
        );
      }
      totalUncompressedBytes += entry.uncompressedSize;
      if (totalUncompressedBytes > limits.maxTotalBytes) {
        throw new UnsafeArchiveError("total_size", "Archive exceeds the total uncompressed limit.");
      }
      const ratio = entry.uncompressedSize / Math.max(1, entry.compressedSize);
      if (ratio > limits.maxCompressionRatio) {
        throw new UnsafeArchiveError("compression_ratio", "Archive compression ratio is unsafe.");
      }
      if (extname(path).toLocaleLowerCase() !== ".md") {
        ignoredCount += 1;
        continue;
      }
      const sourceKey = createHash("sha256").update(path).digest("hex");
      const storagePath = join(outputDirectory, `${sourceKey}.md`);
      const stream = await openReadStream(zip, entry);
      await pipeline(stream, createWriteStream(storagePath, { mode: 0o600, flags: "wx" }));
      const bytes = await readFile(storagePath);
      if (bytes.length !== entry.uncompressedSize || bytes.length > limits.maxEntryBytes) {
        throw new UnsafeArchiveError("entry_size", "Archive entry size changed during extraction.");
      }
      validateUtf8(bytes);
      extracted.push({
        sourceKey,
        relativePath: path,
        storagePath,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.length,
      });
    }
  } finally {
    zip.close();
  }
  return { entries: extracted, ignoredCount, totalUncompressedBytes };
}

export async function registerMarkdownFile(
  filePath: string,
  relativePath: string,
  limits: Pick<ArchiveLimits, "maxEntryBytes" | "maxDepth">,
): Promise<ExtractedMarkdown> {
  const path = validateArchivePath(relativePath, limits.maxDepth);
  if (path.endsWith("/") || extname(path).toLocaleLowerCase() !== ".md") {
    throw new UnsafeArchiveError("invalid_path", "The uploaded file is not Markdown.");
  }
  const info = await stat(filePath);
  if (!info.isFile() || info.size > limits.maxEntryBytes) {
    throw new UnsafeArchiveError("entry_size", "Uploaded Markdown exceeds the size limit.");
  }
  const bytes = await readFile(filePath);
  validateUtf8(bytes);
  return {
    sourceKey: createHash("sha256").update(path).digest("hex"),
    relativePath: path,
    storagePath: filePath,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
  };
}

export async function writeMarkdownZip(
  items: readonly ZipMarkdownItem[],
  outputPath: string,
  report?: string,
): Promise<number> {
  await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
  const zip = new yazl.ZipFile();
  const completed = pipeline(
    zip.outputStream,
    createWriteStream(outputPath, { mode: 0o600, flags: "wx" }),
  );
  const stableDate = new Date("1980-01-01T00:00:00.000Z");
  for (const item of items) {
    zip.addBuffer(Buffer.from(item.markdown, "utf8"), item.archivePath, {
      mtime: stableDate,
      mode: 0o100600,
    });
  }
  if (report) {
    zip.addBuffer(Buffer.from(report, "utf8"), "export-report.txt", {
      mtime: stableDate,
      mode: 0o100600,
    });
  }
  zip.end();
  await completed;
  return (await stat(outputPath)).size;
}

function openZip(path: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(
      path,
      { lazyEntries: true, autoClose: false, validateEntrySizes: true },
      (error, zip) => {
        if (error || !zip) reject(error ?? new Error("Could not open ZIP archive."));
        else resolve(zip);
      },
    );
  });
}

function nextEntry(zip: ZipFile): Promise<Entry | null> {
  return new Promise((resolve, reject) => {
    const onEntry = (entry: Entry) => {
      cleanup();
      resolve(entry);
    };
    const onEnd = () => {
      cleanup();
      resolve(null);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      zip.off("entry", onEntry);
      zip.off("end", onEnd);
      zip.off("error", onError);
    };
    zip.once("entry", onEntry);
    zip.once("end", onEnd);
    zip.once("error", onError);
    zip.readEntry();
  });
}

function openReadStream(zip: ZipFile, entry: Entry): Promise<Readable> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) reject(error ?? new Error("Could not read ZIP entry."));
      else resolve(stream);
    });
  });
}

function validateEntryType(entry: Entry): void {
  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
  const fileType = unixMode & 0o170000;
  if (fileType === 0o120000) {
    throw new UnsafeArchiveError("symlink", "Archive links are not allowed.");
  }
  if (fileType !== 0 && fileType !== 0o100000 && fileType !== 0o040000) {
    throw new UnsafeArchiveError("symlink", "Archive contains an unsupported entry type.");
  }
}

function validateUtf8(bytes: Uint8Array): void {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new UnsafeArchiveError("invalid_encoding", "Markdown must be valid UTF-8.");
  }
}

export function safeDownloadName(input: string): string {
  const name = basename(input)
    .replaceAll('"', "")
    .replace(/[\r\n]/gu, "");
  return name.length > 0 ? name : "download.md";
}
