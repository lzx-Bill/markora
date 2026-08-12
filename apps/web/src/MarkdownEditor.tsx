import { markdown as markdownLanguage } from "@codemirror/lang-markdown";
import {
  maskRawMarkdown,
  RawMarkdownPreservationError,
  renderMarkdown,
  restoreRawMarkdown,
} from "@markora/markdown";
import { Crepe } from "@milkdown/crepe";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import { basicSetup, EditorView } from "codemirror";
import DOMPurify from "dompurify";
import mermaid from "mermaid";
import { useEffect, useMemo, useRef } from "react";
import "katex/dist/katex.min.css";

export type EditorMode = "wysiwyg" | "source" | "split";

export function SourceEditor({
  initialMarkdown,
  onChange,
}: {
  readonly initialMarkdown: string;
  readonly onChange: (markdown: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const initialRef = useRef(initialMarkdown);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const view = new EditorView({
      doc: initialRef.current,
      parent: root,
      extensions: [
        basicSetup,
        markdownLanguage(),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({
          "aria-label": "Markdown source editor",
          spellcheck: "true",
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) changeRef.current(update.state.doc.toString());
        }),
      ],
    });
    return () => view.destroy();
  }, []);

  return <div className="source-editor" ref={rootRef} />;
}

export function WysiwygEditor({
  initialMarkdown,
  onChange,
  onFailure,
  createVisualEditor,
}: {
  readonly initialMarkdown: string;
  readonly onChange: (markdown: string) => void;
  readonly onFailure: (message: string) => void;
  readonly createVisualEditor?: (root: HTMLElement, markdown: string) => Crepe;
}) {
  const rootRef = useRef<HTMLFieldSetElement>(null);
  const initialRef = useRef(initialMarkdown);
  const changeRef = useRef(onChange);
  const failureRef = useRef(onFailure);
  changeRef.current = onChange;
  failureRef.current = onFailure;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const masked = maskRawMarkdown(initialRef.current);
    let userEdited = false;
    const markTextEdit = () => {
      userEdited = true;
    };
    const markControlEdit = (event: Event) => {
      if ((event.target as Element | null)?.closest("button, input, [role='checkbox']")) {
        userEdited = true;
      }
    };
    root.addEventListener("beforeinput", markTextEdit);
    root.addEventListener("paste", markTextEdit);
    root.addEventListener("drop", markTextEdit);
    root.addEventListener("click", markControlEdit);
    const crepe = createVisualEditor
      ? createVisualEditor(root, masked.markdown)
      : new Crepe({
          root,
          defaultValue: masked.markdown,
          features: {
            [Crepe.Feature.ImageBlock]: false,
            [Crepe.Feature.AI]: false,
          },
        });
    let ready = false;
    let disposed = false;
    crepe.on((listener) => {
      listener.markdownUpdated((_context, next, previous) => {
        if (!ready || disposed || !userEdited || next === previous) return;
        try {
          changeRef.current(restoreRawMarkdown(next, masked.rawBlocks));
        } catch (error) {
          const message =
            error instanceof RawMarkdownPreservationError
              ? error.message
              : "The visual editor could not preserve this Markdown. Open Source mode.";
          failureRef.current(message);
        }
      });
    });
    crepe
      .create()
      .then(() => {
        ready = true;
      })
      .catch(() => {
        if (!disposed) {
          failureRef.current(
            "The visual editor could not initialize. Your Markdown is unchanged; open Source mode.",
          );
        }
      });
    return () => {
      disposed = true;
      root.removeEventListener("beforeinput", markTextEdit);
      root.removeEventListener("paste", markTextEdit);
      root.removeEventListener("drop", markTextEdit);
      root.removeEventListener("click", markControlEdit);
      crepe.destroy();
    };
  }, [createVisualEditor]);

  return (
    <fieldset className="wysiwyg-editor" ref={rootRef}>
      <legend className="visually-hidden">WYSIWYG Markdown editor</legend>
    </fieldset>
  );
}

let mermaidInitialized = false;

export function MarkdownPreview({
  markdown,
  onEditSource,
  renderMermaid = true,
}: {
  readonly markdown: string;
  readonly onEditSource: () => void;
  readonly renderMermaid?: boolean;
}) {
  const rootRef = useRef<HTMLElement>(null);
  const html = useMemo(() => renderMarkdown(markdown), [markdown]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.innerHTML = html;
    isolateMathErrors(root, onEditSource);
    if (!renderMermaid) return;
    if (!mermaidInitialized) {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        suppressErrorRendering: true,
        theme: "neutral",
      });
      mermaidInitialized = true;
    }
    let disposed = false;
    const blocks = [...root.querySelectorAll<HTMLElement>("pre > code.language-mermaid")];
    for (const [index, code] of blocks.entries()) {
      const pre = code.parentElement;
      if (!pre) continue;
      const source = code.textContent ?? "";
      const container = document.createElement("section");
      container.className = "mermaid-block";
      container.setAttribute("aria-label", "Mermaid diagram");
      pre.replaceWith(container);
      void mermaid
        .render(`markora-mermaid-${crypto.randomUUID().replaceAll("-", "")}-${index}`, source)
        .then(({ svg, bindFunctions }) => {
          if (disposed) return;
          container.innerHTML = DOMPurify.sanitize(svg, {
            USE_PROFILES: { svg: true, svgFilters: true },
          });
          bindFunctions?.(container);
        })
        .catch(() => {
          if (disposed) return;
          container.className = "special-block-error";
          container.setAttribute("role", "alert");
          const message = document.createElement("p");
          message.textContent =
            "This Mermaid block could not be rendered. The source is unchanged.";
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = "Edit source";
          button.addEventListener("click", onEditSource);
          container.replaceChildren(message, button);
        });
    }
    return () => {
      disposed = true;
    };
  }, [html, onEditSource, renderMermaid]);

  return (
    <article className="markdown-preview" aria-label="Rendered Markdown preview" ref={rootRef} />
  );
}

function isolateMathErrors(root: HTMLElement, onEditSource: () => void) {
  for (const error of root.querySelectorAll<HTMLElement>(".katex-error")) {
    const container = document.createElement("section");
    container.className = "special-block-error";
    container.setAttribute("role", "alert");
    const source = document.createElement("code");
    source.textContent = error.textContent ?? "Invalid math";
    const message = document.createElement("p");
    message.textContent = "This math block could not be rendered. The source is unchanged.";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Edit source";
    button.addEventListener("click", onEditSource);
    container.append(source, message, button);
    error.replaceWith(container);
  }
}
