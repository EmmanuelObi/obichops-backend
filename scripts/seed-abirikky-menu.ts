import "dotenv/config";
import mongoose from "mongoose";
import { connectDb } from "../src/db/connect.js";
import { MenuItem, MenuWeek, Vendor, Workspace } from "../src/models/index.js";
import type { DayOfWeek } from "../src/types/days.js";

const VERTO_SLUG = "verto";
const VENDOR_NAME = "Abirikky foods";
const VENDOR_EMAIL =
  process.env.SEED_ABIRIKKY_EMAIL ?? "orders@abirikkyfoods.com";

/** Naira amounts from vendor menu → price in kobo (cents). */
function naira(amount: number): number {
  return Math.round(amount * 100);
}

type MenuEntry = { name: string; priceNaira: number };

const ABIRIKKY_MENU: Partial<
  Record<Exclude<DayOfWeek, "SAT" | "SUN" | "MON" | "FRI">, MenuEntry[]>
> = {
  TUE: [
    { name: "Jollof rice", priceNaira: 2500 },
    { name: "Spaghetti with Bolognese", priceNaira: 4500 },
    { name: "Ewa agoyin", priceNaira: 2000 },
    { name: "Fufu", priceNaira: 500 },
    { name: "Semovita", priceNaira: 600 },
    { name: "Ogbono", priceNaira: 1000 },
    { name: "Edikangkong", priceNaira: 1500 },
    { name: "Dodo", priceNaira: 1000 },
    { name: "Moinmoin", priceNaira: 1000 },
    { name: "Coleslaw", priceNaira: 1500 },
    { name: "Spinach", priceNaira: 600 },
    { name: "Beef", priceNaira: 1000 },
    { name: "Ponmo", priceNaira: 1000 },
    { name: "Boiled egg", priceNaira: 500 },
    { name: "Goat meat", priceNaira: 2500 },
    { name: "Sauteed fish", priceNaira: 2500 },
    { name: "Roasted chicken", priceNaira: 2500 },
    { name: "Catfish", priceNaira: 2500 },
    { name: "Peppered snail (L)", priceNaira: 5000 },
    { name: "Peppered snail (M)", priceNaira: 3000 },
    { name: "Malt", priceNaira: 700 },
    { name: "Table water", priceNaira: 200 },
    { name: "Pet drinks", priceNaira: 500 },
    { name: "Pack", priceNaira: 300 },
  ],
  WED: [
    { name: "Native rice", priceNaira: 2000 },
    { name: "Plantain porridge", priceNaira: 2500 },
    { name: "Eba", priceNaira: 500 },
    { name: "Poundo", priceNaira: 1000 },
    { name: "Egusi", priceNaira: 1000 },
    { name: "Dodo", priceNaira: 1000 },
    { name: "Moinmoin", priceNaira: 1000 },
    { name: "Beef", priceNaira: 1000 },
    { name: "Ponmo", priceNaira: 1000 },
    { name: "Boiled egg", priceNaira: 500 },
    { name: "Goat meat", priceNaira: 2500 },
    { name: "Sauteed fish", priceNaira: 2500 },
    { name: "Peppered chicken", priceNaira: 2500 },
    { name: "Catfish", priceNaira: 2500 },
    { name: "Malt", priceNaira: 700 },
    { name: "Table water", priceNaira: 200 },
    { name: "Pet drinks", priceNaira: 500 },
    { name: "Pack", priceNaira: 300 },
  ],
  THU: [
    { name: "Fried rice", priceNaira: 2000 },
    { name: "Boiled yam", priceNaira: 2000 },
    { name: "Egg sauce", priceNaira: 1500 },
    { name: "Beans porridge", priceNaira: 2000 },
    { name: "Gounded rice", priceNaira: 1000 },
    { name: "Semo", priceNaira: 600 },
    { name: "Banga", priceNaira: 3000 },
    { name: "Efo riro", priceNaira: 1000 },
    { name: "Dodo", priceNaira: 1000 },
    { name: "Moinmoin", priceNaira: 1000 },
    { name: "Beef", priceNaira: 1000 },
    { name: "Special salad", priceNaira: 2000 },
    { name: "Boiled egg", priceNaira: 500 },
    { name: "Goat meat", priceNaira: 2500 },
    { name: "Sauteed fish", priceNaira: 2500 },
    { name: "Barbeque chicken", priceNaira: 3000 },
    { name: "Catfish", priceNaira: 2500 },
    { name: "Malt", priceNaira: 700 },
    { name: "Table water", priceNaira: 200 },
    { name: "Pet drinks", priceNaira: 500 },
    { name: "Pack", priceNaira: 300 },
  ],
};

async function upsertMenuItem(
  workspaceId: mongoose.Types.ObjectId,
  vendorId: mongoose.Types.ObjectId,
  dayOfWeek: DayOfWeek,
  entry: MenuEntry,
): Promise<"created" | "updated"> {
  const priceCents = naira(entry.priceNaira);
  const existing = await MenuItem.findOne({
    workspaceId,
    vendorId,
    dayOfWeek,
    name: entry.name,
  });

  if (existing) {
    existing.priceCents = priceCents;
    existing.isAvailable = true;
    await existing.save();
    return "updated";
  }

  await MenuItem.create({
    workspaceId,
    vendorId,
    dayOfWeek,
    name: entry.name,
    description: "",
    priceCents,
    isAvailable: true,
  });
  return "created";
}

async function main() {
  await connectDb();

  const workspace = await Workspace.findOne({ slug: VERTO_SLUG, isActive: true });
  if (!workspace) {
    throw new Error(
      `Workspace "${VERTO_SLUG}" not found. Run npm run seed first.`,
    );
  }

  let vendor = await Vendor.findOne({
    workspaceId: workspace._id,
    name: VENDOR_NAME,
  });
  if (!vendor) {
    vendor = await Vendor.findOne({
      workspaceId: workspace._id,
      email: VENDOR_EMAIL.toLowerCase(),
    });
  }
  if (!vendor) {
    vendor = await Vendor.create({
      workspaceId: workspace._id,
      name: VENDOR_NAME,
      email: VENDOR_EMAIL.toLowerCase(),
      isActive: true,
    });
    console.log("Created vendor:", VENDOR_NAME);
  } else {
    vendor.name = VENDOR_NAME;
    vendor.isActive = true;
    await vendor.save();
    console.log("Using vendor:", VENDOR_NAME, vendor._id.toString());
  }

  let created = 0;
  let updated = 0;

  for (const [day, items] of Object.entries(ABIRIKKY_MENU) as Array<
    [DayOfWeek, MenuEntry[]]
  >) {
    for (const entry of items) {
      const result = await upsertMenuItem(
        workspace._id,
        vendor._id,
        day,
        entry,
      );
      if (result === "created") created += 1;
      else updated += 1;
    }
    console.log(`Seeded ${items.length} items for ${day}`);
  }

  const setActiveVendor = process.env.SET_ACTIVE_VENDOR !== "false";
  if (setActiveVendor) {
    const openWeek = await MenuWeek.findOne({
      workspaceId: workspace._id,
      status: "OPEN",
    });
    if (openWeek) {
      openWeek.activeVendorId = vendor._id;
      await openWeek.save();
      console.log("Set Abirikky foods as active vendor on open menu week");
    } else {
      console.log("No OPEN menu week — set active vendor manually in admin");
    }
  }

  console.log(
    `Done. ${created} created, ${updated} updated (${created + updated} total lines).`,
  );
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
