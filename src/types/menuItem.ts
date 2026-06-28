export const MENU_ITEM_KINDS = ["FOOD", "PACK"] as const;
export type MenuItemKind = (typeof MENU_ITEM_KINDS)[number];
