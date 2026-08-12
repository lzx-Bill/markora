import rehypeKatex, { type Options as KatexOptions } from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema, type Options as SanitizeOptions } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

export type MarkdownEditMode = "structured" | "block_source" | "raw_block";
export type MarkdownRenderMode = "safe" | "sandboxed" | "sanitized" | "escaped";
export type MarkdownPreservation = "semantic" | "source_fence" | "byte_exact";

export interface MarkdownCapability {
  readonly construct: string;
  readonly edit: MarkdownEditMode;
  readonly render: MarkdownRenderMode;
  readonly preservation: MarkdownPreservation;
}

export class MarkdownCapabilityRegistry {
  private readonly capabilities = new Map<string, MarkdownCapability>();

  public constructor(capabilities: readonly MarkdownCapability[]) {
    for (const capability of capabilities) {
      if (this.capabilities.has(capability.construct)) {
        throw new Error(`Duplicate Markdown capability: ${capability.construct}`);
      }
      this.capabilities.set(capability.construct, capability);
    }
  }

  public get(construct: string): MarkdownCapability | undefined {
    return this.capabilities.get(construct);
  }

  public list(): readonly MarkdownCapability[] {
    return [...this.capabilities.values()];
  }
}

export const defaultMarkdownCapabilities = new MarkdownCapabilityRegistry([
  { construct: "core", edit: "structured", render: "safe", preservation: "semantic" },
  { construct: "gfm", edit: "structured", render: "safe", preservation: "semantic" },
  {
    construct: "mermaid",
    edit: "block_source",
    render: "sandboxed",
    preservation: "source_fence",
  },
  { construct: "math", edit: "block_source", render: "safe", preservation: "semantic" },
  {
    construct: "raw_html",
    edit: "raw_block",
    render: "sanitized",
    preservation: "byte_exact",
  },
  {
    construct: "unknown",
    edit: "raw_block",
    render: "escaped",
    preservation: "byte_exact",
  },
]);

export const DEFAULT_AUTOSAVE_DEBOUNCE_MS = 1_500;

const sanitizerSchema: SanitizeOptions = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "input", "section"],
  attributes: {
    ...defaultSchema.attributes,
    a: [...(defaultSchema.attributes?.a ?? []), "target", "rel"],
    code: [
      ...(defaultSchema.attributes?.code ?? []),
      ["className", /^language-./, "math-inline", "math-display"],
    ],
    img: [...(defaultSchema.attributes?.img ?? []), "loading", "referrerPolicy"],
    input: ["type", "checked", "disabled"],
    li: [...(defaultSchema.attributes?.li ?? []), ["className", "task-list-item"]],
    section: ["className", "dataMarkdownBlock"],
    ul: [...(defaultSchema.attributes?.ul ?? []), ["className", "contains-task-list"]],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: ["http", "https", "mailto"],
    src: ["http", "https"],
  },
};
const katexOptions: KatexOptions = { strict: "ignore" };

type HastNode = {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

export interface MarkdownRenderOptions {
  readonly externalImages?: boolean;
  readonly linkTarget?: "SAME_TAB" | "NEW_TAB";
  readonly math?: boolean;
}

export function renderMarkdown(markdown: string, options: MarkdownRenderOptions = {}): string {
  const parsed = unified().use(remarkParse).use(remarkGfm);
  if (options.math !== false) parsed.use(remarkMath);
  const html = parsed
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSanitize, sanitizerSchema);
  if (options.math !== false) html.use(rehypeKatex, katexOptions);
  return String(
    html
      .use(() => (tree: HastNode) => hardenExternalContent(tree, options))
      .use(rehypeStringify)
      .processSync(markdown),
  );
}

function hardenExternalContent(node: HastNode, options: MarkdownRenderOptions): void {
  if (node.type === "element" && node.tagName === "a") {
    node.properties = { ...node.properties, rel: ["nofollow", "noopener", "noreferrer"] };
    if (typeof node.properties.href === "string" && /^https?:/i.test(node.properties.href)) {
      if (options.linkTarget !== "SAME_TAB") node.properties.target = "_blank";
      else delete node.properties.target;
    }
  }
  if (node.type === "element" && node.tagName === "img" && options.externalImages !== true) {
    const alt = typeof node.properties?.alt === "string" ? node.properties.alt : "image";
    node.tagName = "span";
    node.properties = { className: ["external-image-placeholder"] };
    node.children = [{ type: "text", value: `External image blocked: ${alt}` } as HastNode];
  }
  if (node.type === "element" && node.tagName === "img" && options.externalImages === true) {
    node.properties = { ...node.properties, loading: "lazy", referrerPolicy: "no-referrer" };
  }
  for (const child of node.children ?? []) hardenExternalContent(child, options);
}

export interface MarkdownOutlineItem {
  readonly level: number;
  readonly text: string;
  readonly line: number;
}

export function extractMarkdownOutline(markdown: string): MarkdownOutlineItem[] {
  const outline: MarkdownOutlineItem[] = [];
  const lines = markdown.split(/\r?\n/);
  let fenced = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (match?.[1] && match[2]) {
      outline.push({ level: match[1].length, text: match[2], line: index + 1 });
    }
  }
  return outline;
}

export interface RawMarkdownBlock {
  readonly token: string;
  readonly source: string;
}

export interface MaskedMarkdown {
  readonly markdown: string;
  readonly rawBlocks: readonly RawMarkdownBlock[];
}

export class RawMarkdownPreservationError extends Error {
  public constructor() {
    super("A raw Markdown block could not be restored exactly. Open Source mode to keep it safe.");
    this.name = "RawMarkdownPreservationError";
  }
}

type PositionedNode = {
  type?: string;
  position?: { start?: { offset?: number }; end?: { offset?: number } };
  children?: PositionedNode[];
};

interface SourceRange {
  readonly start: number;
  readonly end: number;
}

export function maskRawMarkdown(markdown: string): MaskedMarkdown {
  const ranges = collectRawRanges(markdown);
  if (ranges.length === 0) return { markdown, rawBlocks: [] };
  const rawBlocks: RawMarkdownBlock[] = [];
  const parts: string[] = [];
  let cursor = 0;
  for (const [index, range] of ranges.entries()) {
    parts.push(markdown.slice(cursor, range.start));
    const source = markdown.slice(range.start, range.end);
    const token = createRawToken(markdown, index);
    rawBlocks.push({ token, source });
    parts.push(`\n\`\`\`markora-raw\n${token}\n\`\`\`\n`);
    cursor = range.end;
  }
  parts.push(markdown.slice(cursor));
  return { markdown: parts.join(""), rawBlocks };
}

export function restoreRawMarkdown(
  markdown: string,
  rawBlocks: readonly RawMarkdownBlock[],
): string {
  let restored = markdown;
  for (const block of rawBlocks) {
    const token = escapeRegExp(block.token);
    const fenced = new RegExp(
      `(?:\`\`\`|~~~)markora-raw[^\\n]*\\n\\s*${token}\\s*\\n(?:\`\`\`|~~~)`,
      "g",
    );
    if (!fenced.test(restored)) throw new RawMarkdownPreservationError();
    restored = restored.replace(fenced, () => block.source);
  }
  return restored;
}

function collectRawRanges(markdown: string): SourceRange[] {
  const tree = unified().use(remarkParse).parse(markdown) as PositionedNode;
  const ranges: SourceRange[] = [];
  const visit = (node: PositionedNode) => {
    if (
      node.type === "html" &&
      node.position?.start?.offset !== undefined &&
      node.position.end?.offset !== undefined
    ) {
      ranges.push({ start: node.position.start.offset, end: node.position.end.offset });
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree);

  const frontmatter = /^(---|\+\+\+)\r?\n[\s\S]*?\r?\n\1(?=\r?\n|$)/.exec(markdown);
  if (frontmatter) ranges.push({ start: 0, end: frontmatter[0].length });
  const directive = /^:::[^\r\n]*\r?\n[\s\S]*?^:::\s*$/gm;
  for (const match of markdown.matchAll(directive)) {
    if (match.index !== undefined)
      ranges.push({ start: match.index, end: match.index + match[0].length });
  }
  return mergeRanges(ranges);
}

function mergeRanges(ranges: readonly SourceRange[]): SourceRange[] {
  const sorted = [...ranges].sort(
    (left, right) => left.start - right.start || left.end - right.end,
  );
  const merged: SourceRange[] = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) {
      merged[merged.length - 1] = { start: previous.start, end: Math.max(previous.end, range.end) };
    } else {
      merged.push(range);
    }
  }
  return merged;
}

function createRawToken(markdown: string, index: number): string {
  let suffix = 0;
  while (true) {
    const token = `MARKORA_RAW_BLOCK_${index}_${suffix}`;
    if (!markdown.includes(token)) return token;
    suffix += 1;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
