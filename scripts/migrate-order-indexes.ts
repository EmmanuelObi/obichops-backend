import "dotenv/config";

import mongoose from "mongoose";
import { connectDb } from "../src/db/connect.js";
import { Order } from "../src/models/index.js";

/**
 * Replaces the legacy unique index on (userId, menuWeekId) with partial indexes
 * that allow multiple custom proxy orders (userId null) per menu week.
 *
 * Safe to run multiple times.
 */
async function main() {
  await connectDb();

  const collection = Order.collection;
  const indexes = await collection.indexes();

  const legacyStaffIndex = indexes.find(
    (index) =>
      index.name === "userId_1_menuWeekId_1" &&
      !index.partialFilterExpression,
  );

  if (legacyStaffIndex) {
    console.log(
      "Dropping legacy userId_1_menuWeekId_1 index (non-partial — blocks multiple custom orders)...",
    );
    await collection.dropIndex("userId_1_menuWeekId_1");
    console.log("Dropped legacy index.");
  } else {
    console.log("No legacy non-partial userId_1_menuWeekId_1 index found.");
  }

  console.log("Syncing Order indexes from schema...");
  await Order.syncIndexes();
  console.log("Order indexes synced.");

  const updated = await collection.indexes();
  console.log(
    "Current orders indexes:",
    updated.map((index) => ({
      name: index.name,
      key: index.key,
      partialFilterExpression: index.partialFilterExpression ?? null,
    })),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
