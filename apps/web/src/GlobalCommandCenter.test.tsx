// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { Principal } from "@markora/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GlobalCommandCenter } from "./GlobalCommandCenter.js";

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
});

describe("global keyboard surfaces", () => {
  it("opens Quick Open, activates a stable document route and restores focus on Escape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: [
                {
                  documentId: "00000000-0000-4000-8000-000000000010",
                  name: "Decisions.md",
                  path: "/Architecture/Decisions.md",
                  updatedAt: "2026-08-12T00:00:00.000Z",
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );
    renderCenter("/");
    const trigger = screen.getByRole("button", { name: "Return focus target" });
    trigger.focus();
    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    const input = await screen.findByRole("searchbox", { name: "Find a document" });
    expect(input).toHaveFocus();
    await screen.findByRole("option", { name: /Decisions.md/ });
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(trigger).toHaveFocus());

    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    const reopened = await screen.findByRole("searchbox", { name: "Find a document" });
    await screen.findByRole("option", { name: /Decisions.md/ });
    fireEvent.keyDown(reopened, { key: "Enter" });
    expect(await screen.findByTestId("location")).toHaveTextContent(
      "/documents/00000000-0000-4000-8000-000000000010",
    );
  });

  it("filters commands by route state and opens Search with the global shortcut", async () => {
    renderCenter("/search");
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(await screen.findByRole("dialog", { name: "Command Palette" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Create document/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Focus editor/ })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("searchbox", { name: "Find a command" }), { key: "Escape" });

    fireEvent.keyDown(window, { key: "f", ctrlKey: true, shiftKey: true });
    expect(screen.getByTestId("location")).toHaveTextContent("/search");
  });

  it("shows valid Create and Editor groups only in document context", async () => {
    renderCenter("/documents/00000000-0000-4000-8000-000000000010");
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(await screen.findByRole("option", { name: /Create document/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Create folder/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Import Markdown/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Export workspace/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Focus editor/ })).toBeInTheDocument();
  });
});

function renderCenter(initialEntry: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <button type="button">Return focus target</button>
        <GlobalCommandCenter principal={principal} />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function LocationProbe() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}
