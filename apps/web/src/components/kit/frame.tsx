import { Card, Display } from "@tj/ui";
import { type ReactNode, useEffect, useEffectEvent, useState } from "react";

export const KIT_SECTIONS = [
  ["foundations", "Foundations"],
  ["actions", "Actions"],
  ["text-entry", "Text entry"],
  ["choice", "Choice"],
  ["value", "Value"],
  ["overlays", "Overlays"],
  ["feedback", "Feedback"],
  ["motion", "Motion"],
  ["chrome", "Chrome"],
  ["content", "Content"],
] as const;

export type KitSectionId = (typeof KIT_SECTIONS)[number][0];

export function KitFrame({ children }: { children: ReactNode }) {
  const current = useCurrentSection();

  return (
    <main className="mx-auto max-w-[1240px] px-12 py-10">
      <div className="grid grid-cols-[168px_minmax(0,1fr)] gap-x-12">
        <nav aria-label="Sections" className="sticky top-10 self-start">
          <ul className="flex flex-col gap-1">
            {KIT_SECTIONS.map(([id, label]) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  aria-current={current === id ? "true" : undefined}
                  className={
                    current === id
                      ? "block rounded-control bg-brand-quiet px-2 py-1.5 text-body font-semibold text-brand-text"
                      : "block rounded-control px-2 py-1.5 text-body text-ink-3 hover:bg-accent hover:text-foreground"
                  }
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 space-y-16">{children}</div>
      </div>
    </main>
  );
}

export function KitHeader({ children }: { children: ReactNode }) {
  return (
    <header className="mb-12 flex flex-wrap items-start justify-between gap-6">
      <div>
        <Display as="h1" size="lg">
          The kit
        </Display>
        <p className="mt-2 max-w-[58ch] text-lead text-ink-2">
          Every control, surface and overlay in @tj/ui, in every variant and state.
        </p>
      </div>
      {children}
    </header>
  );
}

export function KitGroup({
  id,
  title,
  children,
}: {
  id: KitSectionId;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <div className="mb-5 flex items-center gap-4">
        <Display as="h2" size="sm">
          {title}
        </Display>
        <span aria-hidden className="h-px flex-1 bg-border" />
      </div>
      <Card className="gap-0 overflow-hidden py-0">{children}</Card>
    </section>
  );
}

export function Specimen({
  name,
  note,
  bleed = false,
  headingLevel = 3,
  children,
}: {
  name: string;
  note?: string;
  bleed?: boolean;
  headingLevel?: 2 | 3;
  children: ReactNode;
}) {
  const Heading = `h${headingLevel}` as const;
  return (
    <div
      className={`px-6 py-6 [&+&]:border-t [&+&]:border-border-faint ${bleed ? "" : "grid grid-cols-[200px_minmax(0,1fr)] gap-x-8"}`}
    >
      <div className={bleed ? "mb-4" : ""}>
        <Heading className="text-body font-semibold text-foreground">{name}</Heading>
        {note ? <p className="mt-1 text-meta text-ink-3">{note}</p> : null}
      </div>
      <div className="flex min-w-0 flex-wrap items-start gap-6">{children}</div>
    </div>
  );
}

export function Variant({
  label,
  children,
  grow = false,
}: {
  label: string;
  children: ReactNode;
  grow?: boolean;
}) {
  return (
    <div className={`flex min-w-0 flex-col items-start gap-2 ${grow ? "w-full" : ""}`}>
      <span className="text-eyebrow font-semibold tracking-wide text-ink-3 uppercase">{label}</span>
      {children}
    </div>
  );
}

function useCurrentSection(): KitSectionId {
  const [current, setCurrent] = useState<KitSectionId>(KIT_SECTIONS[0][0]);
  const chooseCurrent = useEffectEvent((elements: HTMLElement[]) => {
    let next: KitSectionId = KIT_SECTIONS[0][0];
    for (const element of elements) {
      if (element.getBoundingClientRect().top <= 96) next = element.id as KitSectionId;
    }
    setCurrent(next);
  });

  useEffect(() => {
    const elements = KIT_SECTIONS.map(([id]) => document.getElementById(id)).filter(
      (element): element is HTMLElement => element !== null,
    );
    if (elements.length === 0) return;
    chooseCurrent(elements);
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(() => chooseCurrent(elements), {
      rootMargin: "-96px 0px -80% 0px",
    });
    for (const element of elements) observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return current;
}
