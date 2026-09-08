import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/*
 * The kit's type ladder is five named sizes (`--text-eyebrow` … `--text-title` in globals.css).
 * tailwind-merge only knows Tailwind's stock `text-xs`…`text-9xl` as sizes; an unknown `text-*`
 * is filed as a colour, so `cn("text-eyebrow", "text-ink-2")` used to drop the size and the
 * element fell back to the 16px browser default. Register them as sizes.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": ["text-eyebrow", "text-meta", "text-body", "text-lead", "text-title"],
    },
  },
});

/**
 * Merge class names. `clsx` handles conditionals/arrays, `tailwind-merge` resolves conflicting
 * Tailwind utilities (the last one wins), so `cn("p-2", className)` lets callers override.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
