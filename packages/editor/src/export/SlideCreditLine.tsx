/**
 * The tiny grey credit a CC BY or BY-SA picture's licence requires, drawn on its slide in the PDF
 * and the PNG run (TEACH-251), from `printedSlide`'s lines. Slide pixels, bottom-right, so it
 * scales with the slide; the parent must be positioned.
 */
export function SlideCreditLine({ credits }: { credits: string[] }) {
  if (credits.length === 0) return null;
  return (
    <p
      data-print-credit
      style={{
        position: "absolute",
        right: 8,
        bottom: 4,
        maxWidth: "70%",
        margin: 0,
        fontFamily: "var(--font-ui, system-ui, sans-serif)",
        fontSize: 9,
        lineHeight: "12px",
        color: "#8a867c",
        textAlign: "right",
      }}
    >
      {credits.join(" · ")}
    </p>
  );
}
