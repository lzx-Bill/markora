import { describe, expect, it } from "vitest";
import { buildVersionDiffRows } from "./version-diff.js";

describe("version preview line comparison", () => {
  it("marks changed, added and removed lines without mutating either source", () => {
    const historical = "标题\nunchanged\nremoved";
    const current = "新标题\nunchanged\n";
    const rows = buildVersionDiffRows(historical, current);
    expect(
      rows.map(({ oldLine, currentLine, changed }) => ({ oldLine, currentLine, changed })),
    ).toEqual([
      { oldLine: "标题", currentLine: "新标题", changed: true },
      { oldLine: "unchanged", currentLine: "unchanged", changed: false },
      { oldLine: "removed", currentLine: "", changed: true },
    ]);
    expect(historical).toBe("标题\nunchanged\nremoved");
    expect(current).toBe("新标题\nunchanged\n");
  });

  it("creates stable unique keys for repeated line pairs", () => {
    const rows = buildVersionDiffRows("same\nsame", "same\nsame");
    expect(new Set(rows.map(({ key }) => key)).size).toBe(2);
  });
});
