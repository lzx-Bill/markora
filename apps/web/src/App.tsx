import { useState } from "react";

const folders = [
  { name: "Architecture", count: 23, active: true },
  { name: "Memory", count: 18 },
  { name: "Learning", count: 12 },
  { name: "Data", count: 16 },
];

const documents = [
  { name: "Welcome to Markora.md", updated: "Just now" },
  { name: "Architecture Notes.md", updated: "Yesterday" },
  { name: "Reading List.md", updated: "3 days ago" },
];

type EditorMode = "WYSIWYG" | "Source" | "Split";

export function App() {
  const [mode, setMode] = useState<EditorMode>("WYSIWYG");
  const [selectedDocument, setSelectedDocument] = useState(documents[0]?.name ?? "");

  return (
    <div className="app-shell">
      <nav className="global-rail panel" aria-label="Global navigation">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            M
          </span>
          <span>
            <strong>Markora</strong>
            <small>My Workspace</small>
          </span>
        </div>
        <ul className="global-links">
          <li>
            <a className="active" href="#documents" aria-label="Documents">
              ▤ <span>Documents</span>
            </a>
          </li>
          <li>
            <a href="#search" aria-label="Search">
              ⌕ <span>Search</span>
            </a>
          </li>
          <li>
            <a href="#trash" aria-label="Trash">
              ♲ <span>Trash</span>
            </a>
          </li>
          <li>
            <a href="#settings" aria-label="Settings">
              ⚙ <span>Settings</span>
            </a>
          </li>
        </ul>
        <button className="primary-action" type="button">
          ＋ New Document
        </button>
      </nav>

      <aside className="folder-drawer panel" aria-labelledby="folders-heading">
        <div className="panel-heading">
          <h2 id="folders-heading">My Documents</h2>
          <button className="icon-button" type="button" aria-label="Create folder">
            ＋
          </button>
        </div>
        <nav aria-label="Folders">
          <ul className="tree">
            <li>
              <button className="tree-root" type="button" aria-expanded="true">
                ⌄　▢ AI
              </button>
              <ul>
                {folders.map((folder) => (
                  <li className={folder.active ? "active" : undefined} key={folder.name}>
                    <button type="button" aria-current={folder.active ? "page" : undefined}>
                      <span>▢ {folder.name}</span>
                      <small>{folder.count}</small>
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          </ul>
        </nav>
      </aside>

      <aside className="document-drawer panel" aria-labelledby="documents-heading">
        <div className="document-heading">
          <p>AI / Architecture</p>
          <div className="panel-heading">
            <h2 id="documents-heading">23 documents</h2>
            <button className="icon-button accent" type="button" aria-label="Create document">
              ＋
            </button>
          </div>
        </div>
        <ul className="document-list">
          {documents.map((document) => (
            <li key={document.name}>
              <button
                className={selectedDocument === document.name ? "selected" : undefined}
                type="button"
                onClick={() => setSelectedDocument(document.name)}
              >
                <span className="document-icon" aria-hidden="true">
                  ▤
                </span>
                <span>
                  <strong>{document.name}</strong>
                  <small>{document.updated}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <main className="work-surface" id="documents">
        <header className="document-header">
          <div>
            <h1>{selectedDocument}</h1>
            <span className="save-status">
              <i /> Saved
            </span>
          </div>
          <button className="icon-button" type="button" aria-label="Document actions">
            •••
          </button>
        </header>
        <div className="editor-toolbar" role="toolbar" aria-label="Editor mode">
          {(["WYSIWYG", "Source", "Split"] as const).map((item) => (
            <button
              className={mode === item ? "active" : undefined}
              key={item}
              type="button"
              aria-pressed={mode === item}
              onClick={() => setMode(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <div className="editor-stage">
          <article className="editor-paper" aria-label="Document editor preview">
            <p className="eyebrow">MARKORA V1</p>
            <h2>A calm place for durable Markdown.</h2>
            <p>
              This Phase 0 shell establishes the visual hierarchy, accessible landmarks, and
              responsive panel behavior. Document editing arrives as a safety-first vertical slice.
            </p>
            <h3>Foundation first</h3>
            <ul>
              <li>Stable runtime contracts</li>
              <li>PostgreSQL-backed durability</li>
              <li>Explicit verification evidence</li>
            </ul>
          </article>
          <aside className="outline" aria-labelledby="outline-heading">
            <h2 id="outline-heading">Outline</h2>
            <a className="active" href="#documents">
              Foundation first
            </a>
          </aside>
        </div>
      </main>
    </div>
  );
}
