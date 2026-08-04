// Server-only auth helpers shared by every /api endpoint.
//
// Design: the browser only ever holds one HttpOnly cookie \u2014 a Supabase
// refresh token. It never sees an access token or the Supabase anon key.
// On every request that needs a signed-in user, we exchange that refresh
// token for a fresh session via Supabase, then use the resulting client
// (with the user's own access token attached) so Row Level Security is
// enforced per-user, exactly as if the browser had signed in directly.

const { anonClient } = require("./supabaseServer");
const { serializeCookie, isLocalRequest } = require("./cookies");

const REFRESH_COOKIE = "sb_refresh_token";
const THIRTY_DAYS = 60 * 60 * 24 * 30;

function setSessionCookie(req, res, session) {
  const cookie = serializeCookie(REFRESH_COOKIE, session.refresh_token, {
    maxAge: THIRTY_DAYS,
    secure: !isLocalRequest(req),
  });
  res.setHeader("Set-Cookie", cookie);
}

function clearSessionCookie(req, res) {
  const cookie = serializeCookie(REFRESH_COOKIE, "", {
    maxAge: 0,
    secure: !isLocalRequest(req),
  });
  res.setHeader("Set-Cookie", cookie);
}

// Call at the top of any protected handler. Returns { client, user } on
// success (and refreshes the cookie), or null after already sending a 401.
async function requireUser(req, res) {
  const refreshToken = req.cookies && req.cookies[REFRESH_COOKIE];
  if (!refreshToken) {
    res.status(401).json({ error: "Not signed in" });
    return null;
  }

  let client;
  try {
    client = anonClient();
  } catch (e) {
    res.status(500).json({ error: e.message });
    return null;
  }

  const { data, error } = await client.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session) {
    clearSessionCookie(req, res);
    res.status(401).json({ error: "Session expired \u2014 please sign in again" });
    return null;
  }

  setSessionCookie(req, res, data.session);
  return { client, user: data.session.user };
}

module.exports = { setSessionCookie, clearSessionCookie, requireUser, REFRESH_COOKIE };
