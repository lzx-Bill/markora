import { describe, expect, it } from "vitest";
import { ApiExceptionFilter } from "./error.filter.js";

describe("ApiExceptionFilter", () => {
  it("is constructible as the global error boundary", () => {
    expect(new ApiExceptionFilter()).toBeInstanceOf(ApiExceptionFilter);
  });
});
