// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchPortability, PortabilityCenter } from "./PortabilityCenter.js";

const now = "2026-08-13T00:00:00.000Z";
const planId = "00000000-0000-4000-8000-000000000061";
const jobId = "00000000-0000-4000-8000-000000000062";
const sourceKey = "a".repeat(64);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("import and background job UI", () => {
  it("requires preview, keeps the editor mounted and exposes terminal results", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/imports/uploads")) {
        return json({ uploadToken: "u".repeat(43), filesReceived: 1, expiresAt: now }, 201);
      }
      if (url.endsWith("/imports/preview")) {
        return json(
          {
            planId,
            targetFolderId: null,
            summary: {
              documents: 1,
              folders: 0,
              ignoredNonMarkdown: 0,
              conflicts: 1,
              normalized: 0,
              totalBytes: 5,
            },
            items: [
              {
                sourceKey,
                sourcePath: "Note.md",
                targetPath: "Note.md",
                bytes: 5,
                status: "CONFLICT",
              },
            ],
            warnings: [],
            expiresAt: now,
          },
          201,
        );
      }
      if (url.includes(`/imports/${planId}/execute`)) {
        return json({ accepted: true, job: job("PENDING", 0) }, 202);
      }
      if (url.endsWith(`/jobs/${jobId}/items`)) {
        return json({
          data: [
            {
              id: "00000000-0000-4000-8000-000000000063",
              sourceKey,
              state: "FAILED",
              attempts: 1,
              errorCode: "IMPORT_ITEM_FAILED",
              result: { reason: "Import item could not be applied." },
            },
          ],
          nextCursor: null,
        });
      }
      if (url.endsWith(`/jobs/${jobId}`)) return json(job("SUCCEEDED_WITH_ISSUES", 100));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const onImported = vi.fn(async () => undefined);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <div data-testid="editor">unsaved editor remains mounted</div>
        <PortabilityCenter onImported={onImported} />
      </QueryClientProvider>,
    );
    await act(async () => {
      dispatchPortability({
        kind: "import",
        files: [new File(["hello"], "Note.md", { type: "text/markdown" })],
        targetFolderId: null,
      });
    });
    expect(screen.getByRole("dialog", { name: "Import documents" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start import" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Preview import" }));
    expect(await screen.findByText("1 conflicts")).toBeInTheDocument();
    expect(screen.getAllByRole("option", { name: "Keep Both" })).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Start import" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Import documents" })).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("editor")).toBeInTheDocument();
    expect(await screen.findByText(/Import · SUCCEEDED_WITH_ISSUES/)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Retry failed" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    await waitFor(() => expect(onImported).toHaveBeenCalled());
  });
});

function job(state: "PENDING" | "SUCCEEDED_WITH_ISSUES", progress: number) {
  return {
    id: jobId,
    type: "IMPORT",
    state,
    targetType: "import-plan",
    targetId: planId,
    progress,
    progressDetail: {
      completed: state === "SUCCEEDED_WITH_ISSUES" ? 1 : 0,
      total: 1,
      currentItem: null,
      phase: state === "SUCCEEDED_WITH_ISSUES" ? "complete" : "queued",
    },
    result:
      state === "SUCCEEDED_WITH_ISSUES" ? { total: 1, succeeded: 0, skipped: 0, failed: 1 } : null,
    errorCode: null,
    parentJobId: null,
    cancellationRequested: false,
    createdAt: now,
    startedAt: state === "SUCCEEDED_WITH_ISSUES" ? now : null,
    completedAt: state === "SUCCEEDED_WITH_ISSUES" ? now : null,
  };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
