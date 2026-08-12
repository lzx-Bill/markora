import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { serializeOpenApi } from "../src/openapi.js";

const outputPath = fileURLToPath(new URL("../openapi.json", import.meta.url));
const committed = await readFile(outputPath, "utf8");

if (committed !== serializeOpenApi()) {
  throw new Error("openapi.json is stale; run pnpm openapi:generate");
}

console.info("OpenAPI contract is current.");
