// Server-only auth helpers shared by every /api endpoint.
//
// Design: the browser holds two HttpOnly cookies it can never read from
// JavaScript — a Supabase refresh token and the current access token.
// It never sees the Supabase anon key.
//
// On a protected request we take the FAST PATH whenever the access token
// is still valid: build a client with it and go, with no Supabase Auth
// round-trip and — crucially — no refresh-token rotation. Only when the
// access token has actually expired (~once an hour) do we take the SLOW
// PATH: exchange the refresh token for a new session and re-set both
// cookies.
//
// The old code refreshed on EVERY request. Because Supabase rotates the
// refresh token on each refresh, the 8-second poll plus a second open tab
// would race, invalidate each other's token, and bounce a still-signed-in
// user back to the login screen. The fast path removes that race.

const { anonClient, authedClient } = require("./supabaseServer");
const { serializeCookie, isLocalRequest } = require("./cookies");
const { decodeJwt, isExpired } = require("./jwt");

const REFRESH_COOKIE = "sb_refresh_token";
const ACCESS_COOKIE = "sb_access_token";
const THIRTY_DAYS = 60 * 60 * 24 * 30;

function sessionCookies(req, session) {
  const secure = !isLocalRequest(req);
  return [
    serializeCookie(REFRESH_COOKIE, session.refresh_token, { maxAge: THIRTY_DAYS, secure }),
    serializeCookie(ACCESS_COOKIE, session.access_token, { maxAge: THIRTY_DAYS, secure }),
  ];
}

function setSessionCookies(req, res, session) {
  res.setHeader("Set-Cookie", sessionCookies(req, session));
}

function clearSessionCookies(req, res) {
  const secure = !isLocalRequest(req);
  res.setHeader("Set-Cookie", [
    serializeCookie(REFRESH_COOKIE, "", { maxAge: 0, secure }),
    serializeCookie(ACCESS_COOKIE, "", { maxAge: 0, secure }),
  ]);
}

function userFromPayload(p) {
  return {
    id: p.sub,
    email: p.email,
    user_metadata: p.user_metadata || {},
  };
}

// Call at the top of any protected handler. Returns { client, user } on
// success, or null after already sending a 401.
async function requireUser(req, res) {
  const cookies = req.cookies || {};
  const refreshToken = cookies[REFRESH_COOKIE];
  const accessToken = cookies[ACCESS_COOKIE];

  if (!refreshToken && !accessToken) {
    res.status(401).json({ error: "Not signed in" });
    return null;
  }

  // ---- Fast path: still-valid access token, no Supabase Auth call ----
  if (accessToken) {
    const payload = decodeJwt(accessToken);
    if (payload && !isExpired(payload)) {
      return {
        client: authedClient(accessToken),
        user: userFromPayload(payload),
        accessToken,
      };
    }
  }

  // ---- Slow path: refresh once, rotate, re-set both cookies ----
  if (!refreshToken) {
    clearSessionCookies(req, res);
    res.status(401).json({ error: "Session expired — please sign in again" });
    return null;
  }

  let client;
  try {
    client = anonClient();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[auth] config error:", e.message);
    res.status(500).json({ error: "Server configuration error" });
    return null;
  }

  const { data, error } = await client.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data || !data.session) {
    clearSessionCookies(req, res);
    res.status(401).json({ error: "Session expired — please sign in again" });
    return null;
  }

  setSessionCookies(req, res, data.session);
  return {
    client: authedClient(data.session.access_token),
    user: data.session.user,
    accessToken: data.session.access_token,
  };
}

module.exports = {
  setSessionCookies,
  clearSessionCookies,
  requireUser,
  REFRESH_COOKIE,
  ACCESS_COOKIE,
};
