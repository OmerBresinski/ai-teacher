import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { base } from "./config.mjs";

const root = fileURLToPath(new URL("./dist", import.meta.url));
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};
// biome-ignore lint/suspicious/noUndeclaredEnvVars: standalone local preview port, never deployed as a server.
const port = Number(process.env.PORT || 4186);
createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === base && base) {
      response.writeHead(308, { Location: `${base}/${url.search}` }).end();
      return;
    }
    if (!url.pathname.startsWith(`${base}/`)) {
      response.writeHead(404).end();
      return;
    }
    let file = resolve(root, `.${decodeURIComponent(url.pathname.slice(base.length))}`);
    if (file !== root && !file.startsWith(root + sep)) {
      response.writeHead(403).end();
      return;
    }
    let status = 200;
    try {
      if ((await stat(file)).isDirectory()) {
        if (!url.pathname.endsWith("/")) {
          response.writeHead(308, { Location: `${url.pathname}/${url.search}` }).end();
          return;
        }
        file = resolve(file, "index.html");
      }
      await stat(file);
    } catch {
      status = 404;
      file = resolve(root, "404.html");
    }
    response.writeHead(status, {
      "Content-Type": types[extname(file)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    createReadStream(file)
      .on("error", () => response.destroy())
      .pipe(response);
  } catch {
    response.writeHead(400).end();
  }
}).listen(port, "127.0.0.1", () => console.log(`Homepage: http://localhost:${port}${base}/`));
