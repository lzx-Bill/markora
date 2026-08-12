// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { ModalFocusGuard } from "./ModalFocusGuard.js";

function Fixture() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <ModalFocusGuard />
      <button type="button">Background</button>
      {open ? (
        <section role="dialog" aria-modal="true" aria-label="Test dialog">
          <input aria-label="First" />
          <button type="button" onClick={() => setOpen(false)}>
            Last
          </button>
        </section>
      ) : null}
    </>
  );
}

describe("ModalFocusGuard", () => {
  it("wraps tab focus inside the active modal", () => {
    const view = render(<Fixture />);
    const first = view.getByRole("textbox", { name: "First" });
    const last = view.getByRole("button", { name: "Last" });

    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(first).toHaveFocus();

    first.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
    view.unmount();
  });
});
