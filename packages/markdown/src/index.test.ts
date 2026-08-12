import { describe, expect, it } from "vitest";
import { defaultMarkdownCapabilities } from "./index.js";

describe("MarkdownCapabilityRegistry", () => {
  it("declares raw HTML as sanitized and byte-preserved", () => {
    expect(defaultMarkdownCapabilities.get("raw_html")).toMatchObject({
      render: "sanitized",
      preservation: "byte_exact",
    });
  });
});
