// Tiny cookie serializer \u2014 no dependency needed for this.

function serializeCookie(name, value, options = {}) {
  const {
    maxAge,
    httpOnly = true,
    secure = true,
    sameSite = "Lax",
    path = "/",
  } = options;

  let str = `${name}=${encodeURIComponent(value)}; Path=${path}`;
  if (maxAge !== undefined) str += `; Max-Age=${maxAge}`;
  if (httpOnly) str += "; HttpOnly";
  if (secure) str += "; Secure";
  if (sameSite) str += `; SameSite=${sameSite}`;
  return str;
}

// Secure cookies require HTTPS. `vercel dev` serves over plain http://localhost,
// so the browser would silently drop a Secure cookie there. Detect that case
// so local dev still works, while production (always HTTPS on Vercel) stays Secure.
function isLocalRequest(req) {
  const host = (req.headers && req.headers.host) || "";
  return host.startsWith("localhost") || host.startsWith("127.0.0.1");
}

module.exports = { serializeCookie, isLocalRequest };
