import { caseFold } from "unicode-case-folding";

export type WorkspaceItemKind = "document" | "folder";

export interface NamingPolicyOptions {
  readonly maxCodePoints: number;
}

export interface ValidatedName {
  readonly name: string;
  readonly normalizedName: string;
}

export class InvalidNameError extends Error {
  public constructor(
    public readonly reason:
      | "empty"
      | "reserved"
      | "unsafe_character"
      | "trailing_character"
      | "too_long"
      | "invalid_extension",
  ) {
    super(`Invalid workspace item name: ${reason}`);
    this.name = "InvalidNameError";
  }
}

const reservedDeviceName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;

function hasUnsafeCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f || character === "/" || character === "\\";
  });
}

export class NamingPolicy {
  public constructor(private readonly options: NamingPolicyOptions = { maxCodePoints: 255 }) {}

  public validate(input: string, kind: WorkspaceItemKind): ValidatedName {
    const name = input.trim().normalize("NFC");
    if (name.length === 0) throw new InvalidNameError("empty");
    if (name === "." || name === ".." || reservedDeviceName.test(name)) {
      throw new InvalidNameError("reserved");
    }
    if (hasUnsafeCharacter(name)) throw new InvalidNameError("unsafe_character");
    if (/[. ]$/u.test(name)) throw new InvalidNameError("trailing_character");
    if ([...name].length > this.options.maxCodePoints) throw new InvalidNameError("too_long");
    if (kind === "document" && !name.toLowerCase().endsWith(".md")) {
      throw new InvalidNameError("invalid_extension");
    }
    return { name, normalizedName: caseFold(name) };
  }
}
