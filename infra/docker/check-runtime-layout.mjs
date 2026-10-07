import { access, readdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(process.argv[2] ?? "/opt/markora");
const required = [
  "api/dist/main.js",
  "api/dist/bootstrap-admin.js",
  "api/node_modules/@markora/database/dist/src/index.js",
  "api/node_modules/@markora/database/dist/generated/client/client.js",
  "worker/dist/main.js",
  "worker/node_modules/@nestjs/core/package.json",
  "web/dist/index.html",
  "web/server.mjs",
  "migration/node_modules/prisma/build/index.js",
  "migration/node_modules/dotenv/config.js",
  "migration/prisma.config.ts",
  "migration/schema.prisma",
  "package.json",
];

for (const relativePath of required) {
  await access(resolve(root, relativePath));
}

const migrations = await readdir(resolve(root, "migration/migrations"), {
  withFileTypes: true,
});
if (!migrations.some((entry) => entry.isDirectory())) {
  throw new Error("No Prisma migration directories are present in the runtime image.");
}

console.log(
  `Runtime layout OK (${required.length} required paths, ${migrations.length} migration entries).`,
);
