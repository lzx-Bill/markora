// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { Crepe } from "@milkdown/crepe";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WysiwygEditor } from "./MarkdownEditor.js";

afterEach(cleanup);

describe("WYSIWYG safety fallback", () => {
  it("reports initialization failure without emitting changed Markdown", async () => {
    const onChange = vi.fn();
    const onFailure = vi.fn();
    const failingEditor = {
      on: vi.fn(),
      create: vi.fn().mockRejectedValue(new Error("init failed")),
      destroy: vi.fn(),
    } as unknown as Crepe;

    render(
      <WysiwygEditor
        initialMarkdown="# Original\n\n<script>preserve me</script>"
        onChange={onChange}
        onFailure={onFailure}
        createVisualEditor={() => failingEditor}
      />,
    );

    await waitFor(() => expect(onFailure).toHaveBeenCalledOnce());
    expect(onFailure.mock.calls[0]?.[0]).toContain("unchanged");
    expect(onChange).not.toHaveBeenCalled();
  });
});
