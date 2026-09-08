import { Button } from "@tj/ui";
import { useState } from "react";
import { KitGroup, Specimen } from "./frame";

export function Motion() {
  const [key, setKey] = useState(0);
  return (
    <KitGroup
      id="motion"
      title="Motion"
      rule="One entrance: 450ms on a single ease-out curve with a 16px rise. Reduced motion keeps the fade and drops the rise. Nothing in the chrome rotates."
    >
      <Specimen
        name="Arrival"
        note="Reduced motion keeps a short opacity fade without translation."
      >
        <div className="flex items-end gap-4">
          <div
            key={key}
            className="motion-safe:animate-arrive rounded-card border border-border bg-card p-5 shadow-1"
          >
            A card arriving in the library
          </div>
          <Button variant="secondary" onClick={() => setKey((value) => value + 1)}>
            Replay
          </Button>
        </div>
      </Specimen>
    </KitGroup>
  );
}
