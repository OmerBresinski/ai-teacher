import { LayoutList } from "lucide-react";
import type { ReactNode } from "react";
import { WORKSHEET_RECIPES, type WorksheetRecipe } from "../model/worksheet-recipes";
import { BLOCK_GROUPS, BLOCK_SPECS, type BlockGroup, type BlockSpec } from "./block-types";

/**
 * What the slash menu lists (TEACH-183): the sixteen block rows (fifteen types, headings twice) in their four groups, then the
 * nine recipes under "Sections". One row shape for both, so the menu's filter, highlight and keys
 * do not care which they are; `pick` says what inserting one means.
 */

export type SlashGroup = BlockGroup | "Sections";

export type SlashPick =
  | { kind: "block"; spec: BlockSpec }
  | { kind: "recipe"; recipe: WorksheetRecipe };

export type SlashItem = {
  id: string;
  label: string;
  description: string;
  group: SlashGroup;
  icon: ReactNode;
  keywords: string[];
  pick: SlashPick;
};

export const SLASH_GROUPS: SlashGroup[] = [...BLOCK_GROUPS, "Sections"];

const sectionIcon = <LayoutList size={16} strokeWidth={1.5} />;

export const SLASH_ITEMS: SlashItem[] = [
  ...BLOCK_SPECS.map<SlashItem>((spec) => ({
    id: spec.id,
    label: spec.label,
    description: spec.description,
    group: spec.group,
    icon: spec.icon,
    keywords: spec.keywords ?? [],
    pick: { kind: "block", spec },
  })),
  ...WORKSHEET_RECIPES.map<SlashItem>((recipe) => ({
    id: `section-${recipe.id}`,
    label: recipe.name,
    description: recipe.line,
    group: "Sections",
    icon: sectionIcon,
    keywords: ["section", "recipe", ...recipe.jobs],
    pick: { kind: "recipe", recipe },
  })),
];

/** Substring match on label, description and keywords (BlockNote's rule), over blocks and sections. */
export function filterSlashItems(query: string): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_ITEMS;
  return SLASH_ITEMS.filter((item) =>
    [item.label, item.description, ...item.keywords].some((text) => text.toLowerCase().includes(q)),
  );
}
