export interface LineItemInput {
  menuItemId?: string;
  dayOfWeek: string;
  quantity: number;
  unitPriceCents: number;
}

export interface DayBreakdown {
  totalCents: number;
}

export interface OrderTotals {
  totalCents: number;
  companyCoveredCents: number;
  excessCents: number;
  orderDayCount: number;
  budgetPoolCents: number;
  isPooled: boolean;
  dayBreakdown: Record<string, DayBreakdown>;
}

export function countDistinctOrderDays(
  lineItems: Array<{ dayOfWeek: string; quantity: number }>,
): number {
  const days = new Set<string>();
  for (const item of lineItems) {
    if (item.quantity > 0) days.add(item.dayOfWeek);
  }
  return days.size;
}

export function calculateOrderTotals(
  lineItems: LineItemInput[],
  maxOrderAmountCents: number,
): OrderTotals {
  const activeItems = lineItems.filter((item) => item.quantity > 0);
  const dayBreakdown: Record<string, DayBreakdown> = {};
  let totalCents = 0;

  for (const item of activeItems) {
    const lineTotal = Math.round(item.unitPriceCents * item.quantity);
    totalCents += lineTotal;
    if (!dayBreakdown[item.dayOfWeek]) {
      dayBreakdown[item.dayOfWeek] = { totalCents: 0 };
    }
    dayBreakdown[item.dayOfWeek]!.totalCents += lineTotal;
  }

  const orderDayCount = Object.keys(dayBreakdown).length;

  let budgetPoolCents = 0;
  if (orderDayCount === 1) {
    budgetPoolCents = maxOrderAmountCents;
  } else if (orderDayCount > 1) {
    budgetPoolCents = orderDayCount * maxOrderAmountCents;
  }

  const companyCoveredCents = Math.min(totalCents, budgetPoolCents);
  const excessCents = Math.max(0, totalCents - budgetPoolCents);

  return {
    totalCents,
    companyCoveredCents,
    excessCents,
    orderDayCount,
    budgetPoolCents,
    isPooled: orderDayCount > 1,
    dayBreakdown,
  };
}
