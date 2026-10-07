import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";

const root = resolve(process.env.WEB_ROOT ?? "/opt/markora/web/dist");
const host = process.env.WEB_HOST ?? "0.0.0.0";
const port = Number.parseInt(process.env.WEB_PORT ?? "27183", 10);
const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".ttf", "font/ttf"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

await access(resolve(root, "index.html"));

const server = createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { allow: "GET, HEAD" }).end();
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
  } catch {
    response.writeHead(400).end();
    return;
  }

  let filePath = resolve(root, `.${pathname}`);
  if (!filePath.startsWith(`${root}${sep}`) && filePath !== root) {
    response.writeHead(404).end();
    return;
  }

  try {
    const fileInfo = await stat(filePath);
    if (fileInfo.isDirectory()) filePath = resolve(filePath, "index.html");
    await access(filePath);
  } catch {
    if (!request.headers.accept?.includes("text/html")) {
      response.writeHead(404).end();
      return;
    }
    filePath = resolve(root, "index.html");
  }

  try {
    const fileInfo = await stat(filePath);
    response.writeHead(200, {
      "content-length": fileInfo.size,
      "content-type": contentTypes.get(extname(filePath)) ?? "application/octet-stream",
      "cache-control": filePath.includes(`${sep}assets${sep}`)
        ? "public, max-age=31536000, immutable"
        : "no-cache",
      "x-content-type-options": "nosniff",
    });
    if (request.method === "HEAD") response.end();
    else await pipeline(createReadStream(filePath), response);
  } catch {
    if (!response.headersSent) response.writeHead(500);
    response.end();
  }
});

server.listen(port, host);
