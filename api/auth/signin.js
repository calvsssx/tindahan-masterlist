const { anonClient } = require("../_lib/supabaseServer");
const { setSessionCookies } = require("../_lib/auth");
const { applyApiHeaders, assertSameOrigin, fail } = require("../_lib/http");

module.exports = async (req, res) => {
  applyApiHeaders(res);
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!assertSameOrigin(req, res)) return;

  let client;
  try {
    client = anonClient();
  } catch (e) {
    return fail(res, e);
  }

  const { email, password } = req.body || {};
  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required." });
    return;
  }

  try {
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) {
      // Supabase's own message here is safe and useful ("Invalid login
      // credentials") and intentionally doesn't reveal whether the email
      // exists.
      res.status(401).json({ error: error.message });
      return;
    }
    setSessionCookies(req, res, data.session);
    res.status(200).json({ ok: true });
  } catch (e) {
    return fail(res, e);
  }
};
