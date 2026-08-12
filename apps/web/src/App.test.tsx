// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "./App.js";

afterEach(cleanup);

describe("Phase 0 application shell", () => {
  it("exposes the four workspace zones and no excluded navigation", () => {
    render(<App />);

    expect(screen.getByRole("navigation", { name: "Global navigation" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Folders" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "23 documents" })).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.queryByText("Favorites")).not.toBeInTheDocument();
    expect(screen.queryByText("Share")).not.toBeInTheDocument();
  });

  it("switches editor mode without replacing the document", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Source" }));
    expect(screen.getByRole("button", { name: "Source" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "Welcome to Markora.md" })).toBeInTheDocument();
  });
});
