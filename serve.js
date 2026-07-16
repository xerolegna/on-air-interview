// Tiny local server for On Air — lets the browser grant and remember mic
// permission, which it often refuses to do for pages opened from disk.
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 8321;
const ROOT = __dirname;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404); res.end("Not found"); return;
  }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, "127.0.0.1", () => {
  console.log("On Air running at http://localhost:" + PORT + "  (Ctrl+C to stop)");
});
