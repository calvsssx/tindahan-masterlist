const { requireUser } = require("../_lib/auth");

module.exports = async (req, res) => {
  const ctx = await requireUser(req, res);
  if (!ctx) return; // requireUser already sent a 401

  const { user } = ctx;
  res.status(200).json({
    ok: true,
    email: user.email,
    name: (user.user_metadata && user.user_metadata.name) || null,
  });
};
