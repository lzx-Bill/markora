// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { Principal } from "@markora/contracts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceShell } from "./App.js";

afterEach(cleanup);

describe("authenticated workspace shell", () => {
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

  function renderShell() {
    return render(
      <MemoryRouter>
        <WorkspaceShell principal={principal} onLogout={() => undefined} />
      </MemoryRouter>,
    );
  }

  it("exposes the four workspace zones and no excluded navigation", () => {
    renderShell();

    expect(screen.getByRole("navigation", { name: "Global navigation" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Folders" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "23 documents" })).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.queryByText("Favorites")).not.toBeInTheDocument();
    expect(screen.queryByText("Share")).not.toBeInTheDocument();
  });

  it("switches editor mode without replacing the document", () => {
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: "Source" }));
    expect(screen.getByRole("button", { name: "Source" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "Welcome to Markora.md" })).toBeInTheDocument();
  });
});
