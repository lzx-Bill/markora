import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { serializeOpenApi } from "../src/openapi.js";

const outputPath = fileURLToPath(new URL("../openapi.json", import.meta.url));
await writeFile(outputPath, serializeOpenApi(), "utf8");
console.info(`Generated ${outputPath}`);
