import { describe, expect, it } from "vitest";
import { createApiError } from "./errors.js";

describe("createApiError", () => {
  it("creates the stable safe error envelope", () => {
    expect(createApiError("NOT_FOUND", "Resource not found.", "req_123")).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Resource not found.",
        requestId: "req_123",
      },
    });
  });
});
