import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge class names. `clsx` handles conditionals/arrays, `tailwind-merge` resolves conflicting
 * Tailwind utilities (the last one wins), so `cn("p-2", className)` lets callers override.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
