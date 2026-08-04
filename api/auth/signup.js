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

  const { name, email, password } = req.body || {};
  if (!name || !email || !password) {
    res.status(400).json({ error: "Name, email, and password are all required." });
    return;
  }

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
    setSessionCookie(req, res, data.session);
    res.status(200).json({ ok: true, signedIn: true });
    return;
  }

  res.status(200).json({ ok: true, signedIn: false });
};
