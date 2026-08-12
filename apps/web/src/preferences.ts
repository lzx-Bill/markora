import type { PreferenceSettings } from "@markora/contracts";

const key = "markora.preference-settings.v1";

export function applyPreferences(settings: PreferenceSettings): void {
  localStorage.setItem(key, JSON.stringify(settings));
  const root = document.documentElement;
  root.dataset.theme = resolvedTheme(settings.theme);
  root.dataset.accent = settings.accent.toLocaleLowerCase();
  root.dataset.density = settings.density.toLocaleLowerCase();
  root.style.setProperty("--mk-interface-font-size", `${settings.interfaceFontSize}px`);
  root.style.setProperty("--mk-reading-width", `${settings.readingWidth}px`);
  root.style.setProperty("--mk-editor-font-size", `${settings.editorFontSize}px`);
  root.style.setProperty("--mk-editor-line-height", String(settings.editorLineHeight));
  root.style.setProperty("--mk-editor-wrap", settings.wrap ? "pre-wrap" : "pre");
}

export function readPreferenceSettings(): Partial<PreferenceSettings> {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "{}") as Partial<PreferenceSettings>;
  } catch {
    return {};
  }
}

function resolvedTheme(theme: PreferenceSettings["theme"]): "light" | "dark" {
  if (theme === "DARK") return "dark";
  if (theme === "LIGHT") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
