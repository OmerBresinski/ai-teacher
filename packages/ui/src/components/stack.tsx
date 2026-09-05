import type * as React from "react";

import { cn } from "../lib/cn";

export type StackProps = React.ComponentProps<"div"> & {
  sheets: React.ReactNode[];
  width: number;
  radius?: 8 | 16;
};

/** Callers provide 26px of headroom for the fanned sheets above the front face. */
function Stack({ sheets, width, radius = 8, className, ...props }: StackProps) {
  const height = Math.round((width * 9) / 16);
  const backWidth = Math.round(width * 0.9);
  const backHeight = Math.round((backWidth * 9) / 16);
  const [front, near, far] = sheets;
  const backSheets = [
    { sheet: far, transform: "rotate(-4deg) translate(-14px, -26px)", zIndex: 1 },
    { sheet: near, transform: "rotate(3.5deg) translate(14px, -17px)", zIndex: 2 },
  ];

  return (
    <div className={cn("relative", className)} style={{ width, height }} {...props}>
      {backSheets.map(({ sheet, transform, zIndex }) =>
        sheet == null ? null : (
          <div
            key={zIndex}
            aria-hidden
            className="absolute overflow-hidden bg-card shadow-2"
            style={{
              width: backWidth,
              height: backHeight,
              left: Math.round((width - backWidth) / 2),
              top: height - backHeight,
              borderRadius: radius,
              transform,
              transformOrigin: "50% 100%",
              zIndex,
            }}
          >
            {sheet}
          </div>
        ),
      )}
      <div
        className="absolute inset-0 overflow-hidden bg-card shadow-2"
        style={{ borderRadius: radius, zIndex: 3 }}
      >
        {front}
      </div>
    </div>
  );
}

export { Stack };
