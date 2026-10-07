import { useQuery } from "@tanstack/react-query";
import {
  Display,
  isTheme,
  Label,
  RadioGroup,
  RadioGroupItem,
  SectionHeading,
  type Theme,
  useTheme,
} from "@tj/ui";
import type { ReactNode } from "react";
import { meQueryOptions } from "@/lib/query";

const THEME_LABELS: Record<Theme, string> = {
  light: "Light",
  dark: "Dark",
  "high-contrast": "High contrast",
  system: "System",
};
const THEME_ORDER: readonly Theme[] = ["light", "dark", "high-contrast", "system"];

/**
 * One page of plain sections (F17 §8: no nested menus). It holds the settings that exist today:
 * the account's name and email, read from `/me` (the auth layout has already fetched it), and the
 * theme, which lives in the browser through `useTheme`. This is the only place to change it.
 */
export function SettingsPage() {
  const { data: me } = useQuery(meQueryOptions);
  const { theme, setTheme } = useTheme();

  return (
    <main className="min-h-dvh px-6 py-8 lg:px-12">
      <div className="flex min-h-9 items-center">
        <Display as="h1" size="lg">
          Settings
        </Display>
      </div>
      <div className="mt-8 flex max-w-2xl flex-col gap-10">
        <Section title="Account">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-body sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-y-3">
            <dt className="text-ink-2">Name</dt>
            <dd className="mb-2 truncate text-foreground sm:mb-0">{me?.user.name || "Not set"}</dd>
            <dt className="text-ink-2">Email</dt>
            <dd className="mb-2 truncate text-foreground sm:mb-0">{me?.user.email}</dd>
          </dl>
        </Section>
        <Section title="Appearance">
          <RadioGroup
            aria-label="Theme"
            value={theme}
            onValueChange={(value) => {
              if (isTheme(value)) setTheme(value);
            }}
          >
            {THEME_ORDER.map((value) => (
              <div key={value} className="flex items-center gap-2.5">
                <RadioGroupItem value={value} id={`settings-theme-${value}`} />
                <Label htmlFor={`settings-theme-${value}`} className="text-body text-foreground">
                  {THEME_LABELS[value]}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </Section>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = `settings-${title.toLowerCase()}`;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 border-t border-border pt-4">
      <SectionHeading id={id}>{title}</SectionHeading>
      {children}
    </section>
  );
}
