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
