const { requireUser } = require("./_lib/auth");
const { rowToItem, itemToRow, seedItems } = require("./_lib/itemMapping");
const { applyApiHeaders, assertSameOrigin, fail } = require("./_lib/http");
const DEFAULT_ITEMS = require("./_lib/defaultItems");

module.exports = async (req, res) => {
  applyApiHeaders(res);
  if (!assertSameOrigin(req, res)) return;

  const ctx = await requireUser(req, res);
  if (!ctx) return;
  const { client } = ctx;

  try {
    if (req.method === "GET") {
      const { count, error: countErr } = await client
        .from("items")
        .select("*", { count: "exact", head: true });
      if (countErr) return fail(res, countErr);

      if (!count) {
        // First run: seed the table from the original spreadsheet list.
        const seeded = JSON.parse(JSON.stringify(DEFAULT_ITEMS));
        await seedItems(client, seeded);
        res.status(200).json({ items: seeded });
        return;
      }

      const { data, error } = await client.from("items").select("*").order("id");
      if (error) return fail(res, error);
      res.status(200).json({ items: data.map(rowToItem) });
      return;
    }

    if (req.method === "POST") {
      const item = req.body;
      if (!item || !item.id || !item.name) {
        res.status(400).json({ error: "Invalid item payload" });
        return;
      }
      const { error } = await client.from("items").upsert(itemToRow(item));
      if (error) return fail(res, error);
      res.status(200).json({ ok: true });
      return;
    }

    if (req.method === "DELETE") {
      const id = Number(req.query.id);
      if (!id) {
        res.status(400).json({ error: "Missing id" });
        return;
      }
      const { error } = await client.from("items").delete().eq("id", id);
      if (error) return fail(res, error);
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    return fail(res, e);
  }
};
