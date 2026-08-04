const { requireUser } = require("../_lib/auth");
const { seedItems } = require("../_lib/itemMapping");
const DEFAULT_ITEMS = require("../_lib/defaultItems");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const ctx = await requireUser(req, res);
  if (!ctx) return;
  const { client } = ctx;

  const { error: delErr } = await client.from("items").delete().gt("id", 0);
  if (delErr) {
    res.status(500).json({ error: delErr.message });
    return;
  }

  const seeded = JSON.parse(JSON.stringify(DEFAULT_ITEMS));
  try {
    await seedItems(client, seeded);
  } catch (e) {
    res.status(500).json({ error: e.message });
    return;
  }

  res.status(200).json({ items: seeded });
};
