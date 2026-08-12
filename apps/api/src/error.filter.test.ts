import { describe, expect, it, vi } from "vitest";
import { ApiExceptionFilter } from "./error.filter.js";

describe("ApiExceptionFilter", () => {
  it("is constructible as the global error boundary", () => {
    expect(new ApiExceptionFilter()).toBeInstanceOf(ApiExceptionFilter);
  });

  it("maps body-parser payload limits to the safe 413 contract", () => {
    const json = vi.fn();
    const header = vi.fn().mockReturnValue({ json });
    const status = vi.fn().mockReturnValue({ header });
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
