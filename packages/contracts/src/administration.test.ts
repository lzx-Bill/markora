import { describe, expect, it } from "vitest";
import { PreferenceSettingsPatchSchema, UpdatePreferencesRequestSchema } from "./administration.js";

describe("administration contracts", () => {
  it("keeps preference PATCH bodies partial without injecting defaults", () => {
    expect(PreferenceSettingsPatchSchema.parse({ accent: "INDIGO" })).toEqual({
      accent: "INDIGO",
    });
    expect(
      UpdatePreferencesRequestSchema.parse({ version: 2, settings: { accent: "INDIGO" } }),
    ).toEqual({ version: 2, settings: { accent: "INDIGO" } });
  });
});
