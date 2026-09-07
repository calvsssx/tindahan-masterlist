// Shared HTTP helpers for every /api endpoint: security headers, a
// same-origin guard for state-changing requests, and a safe way to
// return 500s without leaking internal error text.

// Applied to every API response. The static site gets its headers from
// vercel.json; this covers the JSON endpoints (and local dev).
function applyApiHeaders(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
}

// Defense-in-depth CSRF check for POST/DELETE/PUT/PATCH. The session
// cookie is already SameSite=Lax (so a cross-site fetch can't send it),
// but rejecting requests whose Origin isn't us closes the gap for the
// edge cases Lax still allows.
//
// Returns true if the request may proceed. If not, it has already sent
// a 403 and the caller should return.
function assertSameOrigin(req, res) {
  const method = (req.method || "GET").toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;

  const origin = req.headers && req.headers.origin;
  const host = req.headers && req.headers.host;

  // No Origin header at all: not a browser CORS request (curl, server-to-
  // server, some same-origin form posts). SameSite=Lax still guards the
  // cookie here, so allow it.
  if (!origin) return true;

  try {
    if (new URL(origin).host === host) return true;
  } catch (e) {
    /* malformed Origin — fall through to refusal */
  }

  res.status(403).json({ error: "Cross-origin request refused" });
  return false;
}

// Log the real error server-side (visible in Vercel function logs), send
// a generic message to the client.
function fail(res, err, status = 500) {
  // eslint-disable-next-line no-console
  console.error("[api]", err && err.stack ? err.stack : err);
  res.status(status).json({ error: "Something went wrong. Please try again." });
}

module.exports = { applyApiHeaders, assertSameOrigin, fail };
