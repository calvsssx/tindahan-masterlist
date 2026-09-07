const { requireUser } = require("../_lib/auth");
const { seedItems } = require("../_lib/itemMapping");
const { applyApiHeaders, assertSameOrigin, fail } = require("../_lib/http");
const DEFAULT_ITEMS = require("../_lib/defaultItems");

module.exports = async (req, res) => {
  applyApiHeaders(res);
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!assertSameOrigin(req, res)) return;

  const ctx = await requireUser(req, res);
  if (!ctx) return;
  const { client } = ctx;

  try {
    const { error: delErr } = await client.from("items").delete().gt("id", 0);
    if (delErr) return fail(res, delErr);

    const seeded = JSON.parse(JSON.stringify(DEFAULT_ITEMS));
    await seedItems(client, seeded);

    res.status(200).json({ items: seeded });
  } catch (e) {
    return fail(res, e);
  }
};
