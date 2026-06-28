import "dotenv/config";

import { connectDb } from "../src/db/connect.js";
import { MenuItem } from "../src/models/index.js";

/**
 * Marks existing menu rows named "Pack" as itemKind PACK.
 * Safe to run multiple times.
 */
async function main() {
  await connectDb();

  const candidates = await MenuItem.find({
    name: { $regex: /^pack$/i },
    $or: [{ itemKind: { $exists: false } }, { itemKind: { $ne: "PACK" } }],
  });

  if (candidates.length === 0) {
    console.log("No pack menu items need migration.");
    return;
  }

  let updated = 0;
  for (const item of candidates) {
    item.itemKind = "PACK";
    item.packsRequired = 0;
    await item.save();
    updated += 1;
    console.log(
      `Updated ${item.name} (${item.dayOfWeek}) for vendor ${item.vendorId.toString()}`,
    );
  }

  console.log(`Migration complete: ${updated} item(s) marked as PACK.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    const mongoose = await import("mongoose");
    await mongoose.default.disconnect();
  });
