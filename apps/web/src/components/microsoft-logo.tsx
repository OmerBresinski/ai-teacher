import { cn } from "@tj/ui";
import type { ComponentProps } from "react";

/*
 * Microsoft's four-square logo for "Continue with Microsoft" (TEACH-206). Copied, not drawn: the
 * symbol from Microsoft's sign-in branding guidelines (learn.microsoft.com, "Sign in with
 * Microsoft: branding guidelines for applications", ms-symbollockup_mssymbol_19.svg), squares and
 * colours unchanged. Decorative only: the button's text names the action. Same 18px as GoogleLogo.
 */
export function MicrosoftLogo({ className, ...props }: ComponentProps<"svg">) {
  return (
    <svg aria-hidden="true" className={cn("size-4.5", className)} viewBox="0 0 21 21" {...props}>
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="1" width="9" height="9" fill="#7fbb00" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}
