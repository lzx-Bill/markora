export interface VersionDiffRow {
  readonly key: string;
  readonly oldLine: string;
  readonly currentLine: string;
  readonly changed: boolean;
}

export function buildVersionDiffRows(before: string, after: string): VersionDiffRow[] {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const length = Math.max(beforeLines.length, afterLines.length);
  const occurrences = new Map<string, number>();
  return Array.from({ length }, (_, index) => {
    const oldLine = beforeLines[index] ?? "";
    const currentLine = afterLines[index] ?? "";
    const pair = `${oldLine}\u0000${currentLine}`;
    const occurrence = (occurrences.get(pair) ?? 0) + 1;
    occurrences.set(pair, occurrence);
    return {
      key: `${pair}\u0000${occurrence}`,
      oldLine,
      currentLine,
      changed: oldLine !== currentLine,
    };
  });
}
