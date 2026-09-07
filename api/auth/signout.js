const { clearSessionCookies } = require("../_lib/auth");
const { applyApiHeaders, assertSameOrigin } = require("../_lib/http");

module.exports = async (req, res) => {
  applyApiHeaders(res);
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!assertSameOrigin(req, res)) return;

  clearSessionCookies(req, res);
  res.status(200).json({ ok: true });
};
