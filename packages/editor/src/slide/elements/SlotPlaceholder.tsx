import type { Theme } from "@tj/domain/documents";
import { accentTint } from "@tj/slides";
import { Camera, Shapes } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Where a photograph or a diagram goes, and what the model asked for (look/image-slot): a tinted
 * box, a small muted icon at its corner and caption-size muted words. The editor draws an open
 * photo slot this way; present draws both only under the demo switch (`slot-placeholders.ts`).
 */
export function SlotPlaceholder({
  kind,
  theme,
  radius,
  children,
}: {
  kind: "photo" | "diagram";
  theme: Theme;
  radius?: number | undefined;
  children: ReactNode;
}) {
  const Icon = kind === "photo" ? Camera : Shapes;
  return (
    <div
      data-slot-placeholder={kind}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        borderRadius: radius || undefined,
        background: accentTint(theme),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 28,
        boxSizing: "border-box",
        textAlign: "center",
      }}
    >
      <Icon
        aria-hidden
        size={22}
        strokeWidth={1.75}
        color={theme.colors.muted}
        style={{ position: "absolute", left: 14, top: 14 }}
      />
      <span
        style={{
          fontFamily: theme.fonts.body,
          fontSize: theme.sizes.caption,
          lineHeight: 1.35,
          color: theme.colors.muted,
        }}
      >
        {children}
      </span>
    </div>
  );
}
