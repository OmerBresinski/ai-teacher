import "@tj/ui/styles/lessonco.css";
import "./design-preview.css";
import { Display, useTheme } from "@tj/ui";
import { useEffect } from "react";
import { usePreference } from "@/lib/use-preference";

const storageKey = "tj:design-preview";
const designs = ["current", "lessonco"] as const;
export function DesignWordmark({ compact = false }: { compact?: boolean }) {
  const [design] = usePreference(storageKey, designs, "current");
  return (
    <Display as="span" size="md" className="whitespace-nowrap">
      {design === "lessonco" ? (compact ? "L" : "LessonCo") : compact ? "T" : "TeachDeck"}
    </Display>
  );
}

/** Development-only: compare the same component tree without resetting route or form state. */
export function DesignPreview() {
  const [design, setDesign] = usePreference(storageKey, designs, "current");
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    document.documentElement.dataset.design = design;
    return () => {
      delete document.documentElement.dataset.design;
    };
  }, [design]);

  return (
    <details className="design-preview">
      <summary>
        <span className="design-preview-label">Design preview</span>
        <span className="design-preview-label-compact" aria-hidden>
          UI
        </span>
      </summary>
      <fieldset>
        <legend>App design</legend>
        {(["current", "lessonco"] as const).map((value) => (
          <label key={value}>
            <input
              type="radio"
              name="app-design-preview"
              checked={design === value}
              onChange={() => setDesign(value)}
            />
            {value === "current" ? "Current" : "LessonCo"}
          </label>
        ))}
      </fieldset>
      {design === "lessonco" && resolvedTheme !== "light" ? (
        <p>
          LessonCo styling previews in Light. Choose Light in the normal Theme menu, or the kit’s
          theme tabs. Switching app design does not change your colour-mode preference.
        </p>
      ) : null}
      {design === "lessonco" ? (
        <p>Cream, green ink, Gabarito and paper surfaces. The kit reads the active CSS tokens.</p>
      ) : null}
      <a href="/kit">Open component kit</a>
    </details>
  );
}
