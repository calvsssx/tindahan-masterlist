// Shared between /api/items and /api/items/reset.

function rowToItem(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    unitPrice: row.unit_price,
    wholesalePrice: row.wholesale_price,
    retailPrice: row.retail_price,
    priceHistory: Array.isArray(row.price_history) ? row.price_history : [],
  };
}

function itemToRow(item) {
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    unit_price: item.unitPrice,
    wholesale_price: item.wholesalePrice,
    retail_price: item.retailPrice,
    price_history: item.priceHistory,
    updated_at: new Date().toISOString(),
  };
}

// Inserts in chunks so we don't send one giant request.
async function seedItems(client, list) {
  const rows = list.map(itemToRow);
  for (let i = 0; i < rows.length; i += 250) {
    const chunk = rows.slice(i, i + 250);
    const { error } = await client.from("items").insert(chunk);
    if (error) throw error;
  }
}

module.exports = { rowToItem, itemToRow, seedItems };
