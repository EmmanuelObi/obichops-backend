import type { DayOfWeek } from "../types/days.js";

export interface PackValidatedLineItem {
  menuItemId: string;
  dayOfWeek: DayOfWeek;
  quantity: number;
  unitPriceCents: number;
}

export interface FoodLineForPacks {
  dayOfWeek: DayOfWeek;
  quantity: number;
  packsRequired: number;
}

export interface PackMenuItemForDay {
  menuItemId: string;
  dayOfWeek: DayOfWeek;
  priceCents: number;
}

export function computePackQuantityForDay(
  foodLines: Array<{ quantity: number; packsRequired: number }>,
): number {
  const itemPacks = foodLines.reduce(
    (sum, line) => sum + line.packsRequired * line.quantity,
    0,
  );
  return Math.max(1, itemPacks);
}

export function computePackLineItems(input: {
  foodLineItems: FoodLineForPacks[];
  packMenuItemsByDay: Map<DayOfWeek, PackMenuItemForDay>;
}): PackValidatedLineItem[] {
  const linesByDay = new Map<DayOfWeek, FoodLineForPacks[]>();

  for (const line of input.foodLineItems) {
    const existing = linesByDay.get(line.dayOfWeek) ?? [];
    existing.push(line);
    linesByDay.set(line.dayOfWeek, existing);
  }

  const packLines: PackValidatedLineItem[] = [];

  for (const [dayOfWeek, dayFoodLines] of linesByDay) {
    const packItem = input.packMenuItemsByDay.get(dayOfWeek);
    if (!packItem) {
      throw new Error(`Pack price is not configured for ${dayOfWeek}`);
    }

    const quantity = computePackQuantityForDay(dayFoodLines);
    packLines.push({
      menuItemId: packItem.menuItemId,
      dayOfWeek,
      quantity,
      unitPriceCents: packItem.priceCents,
    });
  }

  return packLines;
}
