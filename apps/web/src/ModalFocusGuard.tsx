import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not(:disabled)",
  "input:not(:disabled)",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function ModalFocusGuard() {
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let activeDialog: HTMLElement | null = null;

    const currentDialog = () =>
      [...document.querySelectorAll<HTMLElement>("[role='dialog'][aria-modal='true']")].at(-1) ??
      null;
    const focusable = (dialog: HTMLElement) =>
      [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
        (element) => element.getAttribute("aria-hidden") !== "true",
      );
    const syncDialog = () => {
      const nextDialog = currentDialog();
      if (nextDialog === activeDialog) return nextDialog;
      if (nextDialog) {
        const focused = document.activeElement;
        returnFocusRef.current = focused instanceof HTMLElement ? focused : null;
      } else if (activeDialog) {
        const target = returnFocusRef.current;
        requestAnimationFrame(() => target?.focus());
        returnFocusRef.current = null;
      }
      activeDialog = nextDialog;
      return nextDialog;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const dialog = syncDialog();
      if (!dialog) return;
      const candidates = focusable(dialog);
      const first = candidates[0];
      const last = candidates.at(-1);
      if (!first || !last) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const focused = document.activeElement;
      if (!dialog.contains(focused)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && focused === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && focused === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const observer = new MutationObserver(syncDialog);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("keydown", onKeyDown, true);
    syncDialog();
    return () => {
      observer.disconnect();
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);

  return null;
}
