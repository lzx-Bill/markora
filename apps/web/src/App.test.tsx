// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { FolderTreeNode, Principal } from "@markora/contracts";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { flattenFolders, GlobalRail } from "./WorkspacePage.js";

afterEach(cleanup);

describe("authenticated workspace navigation", () => {
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

  it("exposes V1 navigation without excluded Favorites or Share", () => {
    render(
      <MemoryRouter>
        <GlobalRail
          principal={principal}
          onLogout={() => undefined}
          current="documents"
          onNewDocument={() => undefined}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("navigation", { name: "Global navigation" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Documents" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Admin" })).toHaveAttribute("href", "/admin/overview");
    expect(screen.queryByText("Favorites")).not.toBeInTheDocument();
    expect(screen.queryByText("Share")).not.toBeInTheDocument();
  });

  it("does not expose Admin navigation to a regular user", () => {
    render(
      <MemoryRouter>
        <GlobalRail
          principal={{ ...principal, role: "USER" }}
          onLogout={() => undefined}
          current="documents"
        />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
  });

  it("flattens the folder tree in stable visual order with depth", () => {
    const child: FolderTreeNode = {
      id: "00000000-0000-4000-8000-000000000011",
      parentId: "00000000-0000-4000-8000-000000000010",
      name: "Child",
      documentCount: 1,
      updatedAt: "2026-08-12T00:00:00.000Z",
      children: [],
    };
    const root: FolderTreeNode = {
      id: "00000000-0000-4000-8000-000000000010",
      parentId: null,
      name: "Root",
      documentCount: 1,
      updatedAt: "2026-08-12T00:00:00.000Z",
      children: [child],
    };
    expect(flattenFolders([root]).map(({ name, depth }) => ({ name, depth }))).toEqual([
      { name: "Root", depth: 0 },
      { name: "Child", depth: 1 },
    ]);
  });
});
