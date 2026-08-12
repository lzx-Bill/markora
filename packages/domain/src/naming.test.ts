import { describe, expect, it } from "vitest";
import { InvalidNameError, NamingPolicy } from "./naming.js";

const policy = new NamingPolicy();

describe("NamingPolicy", () => {
  it("normalizes Unicode and performs full case folding", () => {
    expect(policy.validate(" Straße.md ", "document")).toEqual({
      name: "Straße.md",
      normalizedName: "strasse.md",
    });
  });

  it.each(["../note.md", "CON.md", "note.txt", "note.md."])("rejects %s", (name) => {
    expect(() => policy.validate(name, "document")).toThrow(InvalidNameError);
  });
});
