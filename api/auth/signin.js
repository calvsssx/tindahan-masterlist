const { anonClient } = require("../_lib/supabaseServer");
const { setSessionCookie } = require("../_lib/auth");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let client;
  try {
    client = anonClient();
  } catch (e) {
    res.status(500).json({ error: e.message });
    return;
  }

  const { email, password } = req.body || {};
  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required." });
    return;
  }

  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    res.status(401).json({ error: error.message });
    return;
  }

  setSessionCookie(req, res, data.session);
  res.status(200).json({ ok: true });
};
