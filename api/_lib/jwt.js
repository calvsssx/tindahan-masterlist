// Decode a JWT payload WITHOUT verifying the signature.
//
// We never trust this for authorization of data. Signature verification
// happens server-side at Supabase: PostgREST checks every query's token
// against the project JWT secret, so a tampered or forged token simply
// fails there and returns nothing. Here we only read:
//   - `exp`  to decide when a refresh is actually due
//   - `sub` / `email` / `user_metadata`  for display on /api/auth/me
//
// Doing this locally means a request with a still-valid access token costs
// zero Supabase Auth round-trips and never rotates the refresh token —
// which is what stops the 8s poll and a second browser tab from racing
// each other into a spurious "session expired".

function decodeJwt(token) {
  try {
    const payload = String(token).split(".")[1];
    if (!payload) return null;
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(b64, "base64").toString("utf8");
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

// True when the token is missing an exp, or expires within `skewSeconds`.
function isExpired(payload, skewSeconds = 120) {
  if (!payload || typeof payload.exp !== "number") return true;
  return Date.now() / 1000 >= payload.exp - skewSeconds;
}

module.exports = { decodeJwt, isExpired };
