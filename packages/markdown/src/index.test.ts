import { describe, expect, it } from "vitest";
import {
  defaultMarkdownCapabilities,
  extractMarkdownOutline,
  maskRawMarkdown,
  RawMarkdownPreservationError,
  renderMarkdown,
  restoreRawMarkdown,
} from "./index.js";

describe("MarkdownCapabilityRegistry", () => {
  it("declares raw HTML as sanitized and byte-preserved", () => {
    expect(defaultMarkdownCapabilities.get("raw_html")).toMatchObject({
      render: "sanitized",
      preservation: "byte_exact",
    });
  });
});

describe("safe Markdown renderer", () => {
  it("renders GFM and math while hardening external content", () => {
    const html = renderMarkdown(
      "# 标题\n\n- [x] done\n\n$E=mc^2$\n\n[site](https://example.com)\n\n![alt](https://example.com/a.png)",
    );
    expect(html).toContain("<h1>标题</h1>");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('class="katex"');
    expect(html).toContain('rel="nofollow noopener noreferrer"');
    expect(html).toContain("External image blocked: alt");
    expect(html).not.toContain('src="https://example.com/a.png"');
  });

  it("removes scripts, handlers and unsafe URL protocols without changing source", () => {
    const markdown =
      '<script>globalThis.pwned=true</script>\n<img src="file:///etc/passwd" onerror="alert(1)">\n[bad](javascript:alert(1))';
    const html = renderMarkdown(markdown);
    expect(markdown).toContain("<script>");
    expect(html).not.toMatch(/<script|onerror=|href="javascript:|src="file:/i);
  });

  it("isolates invalid math without dropping surrounding content", () => {
    const html = renderMarkdown("Before\n\n$\\badcommand{$\n\nAfter");
    expect(html).toContain("Before");
    expect(html).toContain('class="katex-error"');
    expect(html).toContain("After");
  });
});

describe("raw-preserved WYSIWYG adapter", () => {
  it("restores raw HTML, frontmatter and unknown directives byte-identically around edits", () => {
    const markdown =
      '---\r\ntitle: "原始"\r\n---\r\n\r\n# Before\r\n\r\n<div data-x="1">raw</div>\r\n\r\n:::unknown keep="yes"\r\nSENTINEL  原样\r\n:::';
    const masked = maskRawMarkdown(markdown);
    expect(masked.rawBlocks).toHaveLength(3);
    const edited = masked.markdown.replace("# Before", "# After");
    const restored = restoreRawMarkdown(edited, masked.rawBlocks);
    expect(restored).toContain("# After");
    for (const block of masked.rawBlocks) expect(restored).toContain(block.source);
  });

  it("fails closed if a raw block sentinel disappears", () => {
    const masked = maskRawMarkdown("<script>safe source only</script>");
    expect(() => restoreRawMarkdown("edited without sentinel", masked.rawBlocks)).toThrow(
      RawMarkdownPreservationError,
    );
  });
});

describe("outline", () => {
  it("extracts headings but ignores fenced code", () => {
    expect(extractMarkdownOutline("# One\n\n```md\n# not heading\n```\n\n## Two")).toEqual([
      { level: 1, text: "One", line: 1 },
      { level: 2, text: "Two", line: 7 },
    ]);
  });
});
