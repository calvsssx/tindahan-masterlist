// Plain-Node local dev server \u2014 no Vercel CLI needed.
//
// Vercel's Serverless Functions normally give handlers a few conveniences
// for free: req.query, req.cookies, req.body (auto-parsed), and
// res.status()/res.json(). This file recreates just enough of that so the
// same /api/*.js handlers run unmodified with plain `node local-server.js`.
//
// Usage:
//   npm install
//   cp .env.example .env.local   (fill in real values)
//   npm start
// Then open http://localhost:3000

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");

// ---------- .env.local loader (same simple parser as before) ----------
function loadDotEnvLocal() {
  const envPath = path.join(__dirname, ".env.local");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadDotEnvLocal();

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  console.warn(
    "[local-server] SUPABASE_URL / SUPABASE_ANON_KEY not set in .env.local \u2014 " +
      "auth and data calls will fail with a clear error until you add them."
  );
}

// ---------- Route table: URL path -> handler file ----------
const routes = {
  "/api/auth/signin": "./api/auth/signin.js",
  "/api/auth/signup": "./api/auth/signup.js",
  "/api/auth/signout": "./api/auth/signout.js",
  "/api/auth/me": "./api/auth/me.js",
  "/api/items": "./api/items.js",
  "/api/items/reset": "./api/items/reset.js",
};

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(";").forEach((part) => {
    const idx = part.indexOf("=");
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  });
  return out;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 5 * 1024 * 1024) {
        reject(new Error("Body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function addResHelpers(res) {
  res.status = function (code) {
    res.statusCode = code;
    return res;
  };
  res.json = function (obj) {
    const body = JSON.stringify(obj);
    if (!res.getHeader("Content-Type")) {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
    }
    res.end(body);
  };
}

// Mirrors the security headers vercel.json applies in production, so local
// dev behaves the same (e.g. CSP violations show up here too).
function setSecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), browsing-topics=()");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; " +
      "base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
  );
}

function serveStatic(req, res, pathname) {
  let filePath = pathname === "/" ? "/index.html" : pathname;
  filePath = path.normalize(path.join(PUBLIC_DIR, filePath));

  // Prevent path traversal outside public/
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.statusCode = 403;
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    res.setHeader("Content-Type", MIME_TYPES[ext] || "application/octet-stream");
    setSecurityHeaders(res);
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  addResHelpers(res);

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  req.query = Object.fromEntries(url.searchParams);
  req.cookies = parseCookies(req.headers.cookie);

  const handlerPath = routes[pathname];

  if (!handlerPath) {
    // Not an API route \u2014 serve it as a static file.
    serveStatic(req, res, pathname);
    return;
  }

  // Parse JSON body for API routes that need it.
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    try {
      const raw = await readBody(req);
      req.body = raw ? JSON.parse(raw) : {};
    } catch (e) {
      req.body = {};
    }
  } else {
    req.body = {};
  }

  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const handler = require(handlerPath);
    await handler(req, res);
  } catch (e) {
    console.error(`[local-server] Error handling ${pathname}:`, e);
    if (!res.headersSent) {
      res.status(500).json({ error: e.message || "Internal server error" });
    }
  }
});

server.listen(PORT, () => {
  console.log(`Ready! Available at http://localhost:${PORT}`);
});
