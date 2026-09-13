import "./design-preview.css";
import { Display, useTheme } from "@tj/ui";
import { useEffect } from "react";
import { usePreference } from "@/lib/use-preference";

const storageKey = "tj:design-preview";
const designs = ["current", "lessonco"] as const;
export function DesignWordmark({ compact = false }: { compact?: boolean }) {
  const [design] = usePreference(storageKey, designs, "lessonco");
  return (
    <Display as="span" size="md" className="whitespace-nowrap">
      {design === "lessonco" ? (compact ? "D" : "DayBack") : compact ? "T" : "TeachDeck"}
    </Display>
  );
}

/** Development-only: compare the same component tree without resetting route or form state. */
export function DesignPreview() {
  const [design, setDesign] = usePreference(storageKey, designs, "lessonco");
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    document.documentElement.dataset.design = design;
    return () => {
      document.documentElement.dataset.design = "lessonco";
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
            {value === "current" ? "Current" : "DayBack v2"}
          </label>
        ))}
      </fieldset>
      {design === "lessonco" && resolvedTheme !== "light" ? (
        <p>
          DayBack uses its cream palette in Light. Dark and High contrast use the established
          accessible themes. Switching app design does not change your colour-mode preference.
        </p>
      ) : null}
      {design === "lessonco" ? (
        <p>
          DayBack · cream, green ink and paper surfaces. The kit shows the active design tokens.
        </p>
      ) : null}
      <a href="/kit">Open component kit</a>
    </details>
  );
}
