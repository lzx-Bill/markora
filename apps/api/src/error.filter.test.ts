import { describe, expect, it, vi } from "vitest";
import { ApiExceptionFilter } from "./error.filter.js";

describe("ApiExceptionFilter", () => {
  it("is constructible as the global error boundary", () => {
    expect(new ApiExceptionFilter()).toBeInstanceOf(ApiExceptionFilter);
  });

  it("maps body-parser payload limits to the safe 413 contract", () => {
    const json = vi.fn();
    const chain = { json, header: vi.fn() };
    chain.header.mockReturnValue(chain);
    const status = vi.fn().mockReturnValue(chain);
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({ header: () => undefined }),
        getResponse: () => ({ status }),
      }),
    };

    new ApiExceptionFilter().catch(
      Object.assign(new Error("entity too large"), { status: 413 }),
      host as never,
    );

    expect(status).toHaveBeenCalledWith(413);
    expect(json.mock.calls[0]?.[0]).toMatchObject({ error: { code: "LIMIT_EXCEEDED" } });
  });
});
