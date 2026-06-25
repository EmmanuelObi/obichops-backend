import "dotenv/config";
import mongoose from "mongoose";
import { getEnv } from "../src/config/env.js";
import { connectDb } from "../src/db/connect.js";
import {
  AllowedEmail,
  MenuItem,
  MenuWeek,
  User,
  Vendor,
  Workspace,
} from "../src/models/index.js";
import { hashPassword } from "../src/services/password.js";
import { DateTime } from "luxon";
import {
  DEFAULT_MAX_ORDER_AMOUNT_CENTS,
  DEFAULT_MAX_ORDER_DAYS_PER_STAFF,
  DEFAULT_ORDERABLE_DAYS,
  DEFAULT_TIMEZONE,
  getNextMonday,
} from "../src/services/menuWeekWindow.js";
import { DAYS_OF_WEEK, type DayOfWeek } from "../src/types/days.js";

const WEEKDAY_MENU: Record<
  Exclude<DayOfWeek, "SAT" | "SUN">,
  Array<{ name: string; description: string; priceCents: number }>
> = {
  MON: [
    {
      name: "Jollof Rice & Chicken",
      description: "Spicy jollof with grilled chicken",
      priceCents: 250000,
    },
    {
      name: "Fried Rice",
      description: "Vegetable fried rice",
      priceCents: 200000,
    },
  ],
  TUE: [
    {
      name: "Egusi Soup & Pounded Yam",
      description: "Rich egusi with swallow",
      priceCents: 280000,
    },
    {
      name: "Efo Riro & Rice",
      description: "Spinach stew with white rice",
      priceCents: 220000,
    },
  ],
  WED: [
    {
      name: "Pepper Soup & Plantain",
      description: "Goat pepper soup",
      priceCents: 240000,
    },
    {
      name: "Beans & Dodo",
      description: "Stewed beans with fried plantain",
      priceCents: 180000,
    },
  ],
  THU: [
    {
      name: "Ofada Rice & Ayamase",
      description: "Local rice with designer stew",
      priceCents: 260000,
    },
    {
      name: "Spaghetti Bolognese",
      description: "Beef mince pasta",
      priceCents: 210000,
    },
  ],
  FRI: [
    {
      name: "Suya Wrap",
      description: "Spicy beef suya in flatbread",
      priceCents: 230000,
    },
    {
      name: "Shawarma Plate",
      description: "Chicken shawarma with fries",
      priceCents: 250000,
    },
  ],
};

const VENDORS = [
  { name: "Mama Put Kitchen", email: "orders@mamaput.example" },
  { name: "Lagos Bites", email: "hello@lagosbites.example" },
];

const VERTO_ALLOWED_EMAIL_DOMAINS = ["vertofx.com", "verto.co"];

async function seedVendorMenu(
  workspaceId: mongoose.Types.ObjectId,
  vendorId: mongoose.Types.ObjectId,
) {
  const weekdays = DAYS_OF_WEEK.filter(
    (d): d is Exclude<DayOfWeek, "SAT" | "SUN"> => d !== "SAT" && d !== "SUN",
  );

  for (const day of weekdays) {
    for (const item of WEEKDAY_MENU[day]) {
      const exists = await MenuItem.findOne({
        workspaceId,
        vendorId,
        dayOfWeek: day,
        name: item.name,
      });
      if (exists) continue;

      await MenuItem.create({
        workspaceId,
        vendorId,
        dayOfWeek: day,
        name: item.name,
        description: item.description,
        priceCents: item.priceCents,
        isAvailable: true,
      });
    }
  }
}

async function main() {
  await connectDb();
  const env = getEnv();

  const superEmail =
    process.env.SEED_SUPER_ADMIN_EMAIL ?? "emmanuel@obichops.com";
  const superPassword =
    process.env.SEED_SUPER_ADMIN_PASSWORD ?? "Kolikoman123$";
  const vertoAdminEmail =
    process.env.SEED_VERTO_ADMIN_EMAIL ?? "joy.johnson@vertofx.com";
  const vertoAdminPassword =
    process.env.SEED_VERTO_ADMIN_PASSWORD ?? "ChangeMeAdmin123!";
  const staffEmail = process.env.SEED_STAFF_EMAIL ?? "emmanuel.obi@vertofx.com";
  const staffPassword = process.env.SEED_STAFF_PASSWORD ?? "ChangeMeStaff123!";

  let superAdmin = await User.findOne({ email: superEmail, workspaceId: null });
  if (!superAdmin) {
    superAdmin = await User.create({
      email: superEmail,
      passwordHash: await hashPassword(superPassword),
      name: "Super Admin",
      role: "SUPER_ADMIN",
      workspaceId: null,
    });
    console.log("Created super admin:", superEmail);
  } else {
    console.log("Super admin already exists:", superEmail);
  }

  let workspace = await Workspace.findOne({ slug: "verto" });
  if (!workspace) {
    workspace = await Workspace.create({
      name: "Verto",
      slug: "verto",
      isActive: true,
      settings: {
        allowedEmailDomains: VERTO_ALLOWED_EMAIL_DOMAINS,
      },
    });
    console.log("Created workspace Verto:", workspace._id.toString());
    console.log("Allowed email domains:", VERTO_ALLOWED_EMAIL_DOMAINS.join(", "));
  } else {
    await Workspace.updateOne(
      { _id: workspace._id },
      { $set: { "settings.allowedEmailDomains": VERTO_ALLOWED_EMAIL_DOMAINS } },
    );
    workspace = await Workspace.findById(workspace._id);
    console.log("Workspace Verto already exists:", workspace!._id.toString());
    console.log("Allowed email domains:", VERTO_ALLOWED_EMAIL_DOMAINS.join(", "));
  }

  const workspaceId = workspace._id;

  await AllowedEmail.findOneAndUpdate(
    { workspaceId, email: vertoAdminEmail.toLowerCase() },
    { workspaceId, email: vertoAdminEmail.toLowerCase(), role: "ADMIN" },
    { upsert: true, new: true },
  );

  let vertoAdmin = await User.findOne({ email: vertoAdminEmail, workspaceId });
  if (!vertoAdmin) {
    vertoAdmin = await User.create({
      email: vertoAdminEmail.toLowerCase(),
      passwordHash: await hashPassword(vertoAdminPassword),
      role: "ADMIN",
      workspaceId,
      mustChangePassword: true,
    });
    console.log("Created Verto admin:", vertoAdminEmail);
  } else {
    if (!vertoAdmin.firstName?.trim()) {
      if (vertoAdmin.name === "Verto Admin") {
        vertoAdmin.name = undefined;
      }
      vertoAdmin.firstName = undefined;
      vertoAdmin.lastName = undefined;
      vertoAdmin.mustChangePassword = true;
      await vertoAdmin.save();
    }
    console.log("Verto admin already exists:", vertoAdminEmail);
  }

  for (const vendorData of VENDORS) {
    let vendor = await Vendor.findOne({
      workspaceId,
      email: vendorData.email.toLowerCase(),
    });
    if (!vendor) {
      vendor = await Vendor.create({
        workspaceId,
        name: vendorData.name,
        email: vendorData.email.toLowerCase(),
        isActive: true,
      });
      console.log("Created vendor:", vendor.name);
    } else {
      console.log("Vendor already exists:", vendor.name);
    }

    await seedVendorMenu(workspaceId, vendor._id);
    console.log("Seeded menu for:", vendor.name);
  }

  await AllowedEmail.findOneAndUpdate(
    { workspaceId, email: staffEmail.toLowerCase() },
    { workspaceId, email: staffEmail.toLowerCase(), role: "STAFF" },
    { upsert: true, new: true },
  );

  let staffUser = await User.findOne({ email: staffEmail, workspaceId });
  if (!staffUser) {
    staffUser = await User.create({
      email: staffEmail.toLowerCase(),
      passwordHash: await hashPassword(staffPassword),
      role: "STAFF",
      workspaceId,
      mustChangePassword: true,
    });
    console.log("Created staff user:", staffEmail);
  } else {
    if (staffUser.name === "Verto Staff") {
      staffUser.name = undefined;
      staffUser.firstName = undefined;
      staffUser.lastName = undefined;
      staffUser.mustChangePassword = true;
      await staffUser.save();
    }
    console.log("Staff user already exists:", staffEmail);
  }

  const primaryVendor = await Vendor.findOne({
    workspaceId,
    isActive: true,
  }).sort({
    name: 1,
  });
  if (primaryVendor) {
    const timezone = workspace.settings?.timezone ?? DEFAULT_TIMEZONE;
    const weekStart = getNextMonday(timezone).toUTC().toJSDate();
    const now = DateTime.now().setZone(timezone);
    const orderWindowOpensAt = now.minus({ hours: 1 }).toUTC().toJSDate();
    const orderWindowClosesAt = now.plus({ days: 7 }).toUTC().toJSDate();

    const menuWeek = await MenuWeek.findOneAndUpdate(
      { workspaceId, weekStart },
      {
        $set: {
          workspaceId,
          weekStart,
          activeVendorId: primaryVendor._id,
          orderableDays: DEFAULT_ORDERABLE_DAYS,
          maxOrderAmountCents: DEFAULT_MAX_ORDER_AMOUNT_CENTS,
          maxOrderDaysPerStaff: DEFAULT_MAX_ORDER_DAYS_PER_STAFF,
          orderWindowOpensAt,
          orderWindowClosesAt,
          status: "OPEN",
        },
      },
      { upsert: true, new: true },
    );
    console.log(
      "Menu week ready for ordering:",
      weekStart.toISOString(),
      `(status: ${menuWeek.status})`,
    );
  }

  console.log("Seed complete.");
  console.log("APP_BASE_URL:", env.APP_BASE_URL);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
