const { anonClient } = require("../_lib/supabaseServer");
const { setSessionCookies } = require("../_lib/auth");
const { applyApiHeaders, assertSameOrigin, fail } = require("../_lib/http");

const MIN_PASSWORD = 8;

module.exports = async (req, res) => {
  applyApiHeaders(res);
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!assertSameOrigin(req, res)) return;

  const { name, email, password, inviteCode } = req.body || {};

  // Optional gate: if SIGNUP_INVITE_CODE is set, registration requires it.
  // This keeps a private household list from being joined (and reset) by
  // anyone who stumbles onto the URL. If the env var is unset, signup is
  // open exactly as before.
  const requiredCode = process.env.SIGNUP_INVITE_CODE;
  if (requiredCode && String(inviteCode || "") !== requiredCode) {
    res.status(403).json({ error: "That invite code isn't valid." });
    return;
  }

  if (!name || !email || !password) {
    res.status(400).json({ error: "Name, email, and password are all required." });
    return;
  }
  if (String(password).length < MIN_PASSWORD) {
    res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters.` });
    return;
  }

  let client;
  try {
    client = anonClient();
  } catch (e) {
    return fail(res, e);
  }

  try {
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: { data: { name } },
    });

    if (error) {
      res.status(400).json({ error: error.message });
      return;
    }

    if (data.session) {
      // Email confirmation is off in Supabase settings — signed in immediately.
      setSessionCookies(req, res, data.session);
      res.status(200).json({ ok: true, signedIn: true });
      return;
    }

    res.status(200).json({ ok: true, signedIn: false });
  } catch (e) {
    return fail(res, e);
  }
};
