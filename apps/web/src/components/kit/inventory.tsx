import {
  DialogOverlay,
  DialogPortal,
  DropdownMenuPortal,
  SelectScrollDownButton,
  SelectScrollUpButton,
  ThemeProvider,
  Toaster,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@tj/ui";

// These primitives are rendered by their composed parent components in the gallery or app shell.
// Keep their exports explicit so the coverage test detects additions to @tj/ui's public surface.
export const kitComposedPrimitives = [
  DialogOverlay,
  DialogPortal,
  DropdownMenuPortal,
  SelectScrollDownButton,
  SelectScrollUpButton,
  ThemeProvider,
  Toaster,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
];
