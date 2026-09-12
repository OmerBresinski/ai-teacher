import { useEffect, useState } from "react";

const properties = [
  "--background",
  "--foreground",
  "--card",
  "--brand-tint",
  "--radius-key",
  "--radius-chip",
  "--radius-control",
  "--radius-card",
  "--radius-dialog",
  "--radius-face",
  "--duration-arrive",
  "--arrive-rise",
  "--font-ui",
  "--font-display",
  "--text-eyebrow",
  "--text-eyebrow--line-height",
  "--text-meta",
  "--text-meta--line-height",
  "--text-body",
  "--text-body--line-height",
  "--text-lead",
  "--text-lead--line-height",
] as const;

export type DesignValues = Record<(typeof properties)[number], string>;

function readValues(): DesignValues {
  const styles = getComputedStyle(document.documentElement);
  return Object.fromEntries(
    properties.map((property) => [property, styles.getPropertyValue(property).trim()]),
  ) as DesignValues;
}

/** Keeps kit annotations tied to the CSS tokens currently applied to the document. */
export function useDesignValues(): DesignValues | undefined {
  const [values, setValues] = useState<DesignValues | undefined>(() =>
    typeof document === "undefined" ? undefined : readValues(),
  );

  useEffect(() => {
    const update = () => {
      const next = readValues();
      setValues((current) =>
        current && properties.every((property) => current[property] === next[property])
          ? current
          : next,
      );
    };
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-design", "data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  return values;
}

export function tokenLabel(value: string | undefined, fallback: string): string {
  return value || fallback;
}
