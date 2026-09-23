import { Link } from "@tanstack/react-router";
import { Display } from "@tj/ui";
import { type ReactNode, useEffect } from "react";
import { CharacterHost, type CharacterStage } from "./character-host";
import "./creation.css";

export function CreationShell({
  stage,
  title,
  children,
  working = false,
}: {
  stage: CharacterStage;
  title: string;
  children: ReactNode;
  working?: boolean;
}) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: each new step announces its heading.
  useEffect(() => {
    document.getElementById("creation-title")?.focus({ preventScroll: true });
  }, [stage]);
  return (
    <main className="creation-shell">
      <header className="creation-header">
        <Link to="/lessons" aria-label="DayBack — back to lessons" className="creation-brand">
          dayback<span>.</span>
        </Link>
      </header>
      <div className="creation-layout">
        <aside aria-hidden="true" className="creation-character" data-working={working}>
          <CharacterHost stage={stage} />
        </aside>
        <section
          key={stage}
          className="creation-step"
          aria-labelledby="creation-title"
          data-testid={`creation-${stage}`}
        >
          <Display as="h1" id="creation-title" tabIndex={-1} size="xl">
            {title}
          </Display>
          {children}
        </section>
      </div>
    </main>
  );
}
