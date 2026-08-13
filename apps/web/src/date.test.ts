import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime } from "./date.js";

describe("UI date formatting", () => {
  it("always uses English date and time labels", () => {
    expect(formatDate("2026-08-12T22:51:00+08:00")).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
    expect(formatDateTime("2026-08-12T22:51:00+08:00")).toMatch(
      /^[A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2} [AP]M$/,
    );
  });
});
