// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { Principal } from "@markora/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminPage } from "./AdminPage.js";
import { SettingsPage } from "./SettingsPage.js";

const principal: Principal = {
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000002",
  sessionId: "00000000-0000-4000-8000-000000000003",
  username: "admin",
  email: "admin@example.com",
  displayName: "Administrator",
  role: "ADMIN",
  mustChangePassword: false,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe("Phase 7 settings and admin UI", () => {
  it("auto-saves a typed preference and applies it immediately", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(preferences("SYSTEM", 1)))
      .mockResolvedValueOnce(json(preferences("DARK", 2)));
    vi.stubGlobal("fetch", fetchMock);
    renderPage(
      "/settings/appearance",
      <Route
        path="/settings/:category"
        element={<SettingsPage principal={principal} onLogout={() => undefined} sessions={null} />}
      />,
    );
    const theme = await screen.findByRole("combobox", { name: "Theme" });
    fireEvent.change(theme, { target: { value: "DARK" } });
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/v1/preferences",
      expect.objectContaining({ method: "PATCH", body: expect.stringContaining('"version":1') }),
    );
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("keeps the prior preference active and gives a recovery action on save failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(json(preferences("LIGHT", 1)))
        .mockResolvedValueOnce(
          json(
            {
              error: {
                code: "CONFIG_VERSION_CONFLICT",
                message: "Reload before saving.",
                requestId: "req_phase7",
              },
            },
            409,
          ),
        ),
    );
    renderPage(
      "/settings/appearance",
      <Route
        path="/settings/:category"
        element={<SettingsPage principal={principal} onLogout={() => undefined} sessions={null} />}
      />,
    );
    fireEvent.change(await screen.findByRole("combobox", { name: "Theme" }), {
      target: { value: "DARK" },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("previous setting is still active");
    expect(document.documentElement.dataset.theme).not.toBe("dark");
  });

  it("serializes rapid preference changes against the latest confirmed version", async () => {
    let releaseFirst: (() => void) | undefined;
    const firstSaved = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(preferences("SYSTEM", 1)))
      .mockImplementationOnce(async () => {
        await firstSaved;
        return json(preferences("DARK", 2));
      })
      .mockResolvedValueOnce(json(preferences("DARK", 3, "INDIGO")));
    vi.stubGlobal("fetch", fetchMock);
    renderPage(
      "/settings/appearance",
      <Route
        path="/settings/:category"
        element={<SettingsPage principal={principal} onLogout={() => undefined} sessions={null} />}
      />,
    );
    fireEvent.change(await screen.findByRole("combobox", { name: "Theme" }), {
      target: { value: "DARK" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Accent" }), {
      target: { value: "INDIGO" },
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    releaseFirst?.();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const secondPatch = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)) as {
      version: number;
      settings: { accent: string };
    };
    expect(secondPatch).toMatchObject({ version: 2, settings: { accent: "INDIGO" } });
    await waitFor(() => expect(document.documentElement.dataset.accent).toBe("indigo"));
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("requires review before explicitly applying a complete admin config", async () => {
    const config = {
      version: 1,
      values: {
        documentMaxBytes: 5242880,
        trashRetentionDays: 30,
        versionRetentionDays: 90,
        sessionTtlDays: 30,
        importMaxFiles: 2000,
        importMaxTotalBytes: 104857600,
        exportDownloadTtlMinutes: 60,
        externalImagesEnabled: false,
      },
      updatedAt: null,
      updatedBy: null,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(config))
      .mockResolvedValueOnce(json({ ...config, version: 2 }));
    vi.stubGlobal("fetch", fetchMock);
    renderPage(
      "/admin/config",
      <Route
        path="/admin/:section"
        element={<AdminPage principal={principal} onLogout={() => undefined} />}
      />,
    );
    expect(
      await screen.findByText(
        "Version 1. Edit a complete staged copy, review it, then explicitly apply.",
      ),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    expect(screen.getByRole("dialog", { name: "Review system settings" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apply settings" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByText(
        "Version 2. Edit a complete staged copy, review it, then explicitly apply.",
      ),
    ).toBeInTheDocument();
  });
});

function renderPage(path: string, route: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>{route}</Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function preferences(
  theme: "LIGHT" | "DARK" | "SYSTEM",
  version: number,
  accent: "BLUE" | "INDIGO" | "TEAL" = "BLUE",
) {
  return {
    schemaVersion: 1,
    version,
    displayName: "Administrator",
    updatedAt: null,
    capabilities: { externalImages: false },
    settings: {
      language: "en",
      theme,
      accent,
      density: "COMFORTABLE",
      interfaceFontSize: 16,
      defaultEditorMode: "wysiwyg",
      readingWidth: 960,
      editorFontSize: 16,
      editorLineHeight: 1.6,
      wrap: true,
      tabSize: 2,
      outline: true,
      sourceLineNumbers: true,
      autoSave: true,
      mermaid: true,
      math: true,
      externalImages: false,
      linkTarget: "NEW_TAB",
      documentSort: "UPDATED",
      documentDirection: "DESC",
      rememberExpandedFolders: true,
      restoreLastWorkspaceState: true,
      searchScope: "WORKSPACE",
      includeCodeBlocks: true,
    },
  };
}
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
