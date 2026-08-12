import { describe, expect, it } from "vitest";
import { stripCode } from "./search.service.js";

describe("search Markdown normalization", () => {
  it("removes fenced and inline code while preserving prose", () => {
    const markdown =
      "Visible words\n```ts\nconst value = `secretCode`;\n```\nKeep `inlineSecret` prose";
    const normalized = stripCode(markdown);
    expect(normalized).toContain("Visible words");
    expect(normalized).toContain("Keep");
    expect(normalized).not.toContain("secretCode");
    expect(normalized).not.toContain("const value");
    expect(normalized).not.toContain("inlineSecret");
  });
});
