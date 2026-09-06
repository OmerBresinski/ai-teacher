import { Button } from "@tj/ui";
import { useState } from "react";
import { KitGroup, Specimen } from "./frame";

export function Motion() {
  const [key, setKey] = useState(0);
  return (
    <KitGroup id="motion" title="Motion">
      <Specimen
        name="animate-arrive"
        note="Reduced motion keeps a short opacity fade without translation."
      >
        <div className="flex items-end gap-4">
          <div
            key={key}
            className="motion-safe:animate-arrive rounded-card border border-border bg-card p-5 shadow-1"
          >
            Arrival demo
          </div>
          <Button variant="secondary" onClick={() => setKey((value) => value + 1)}>
            Replay
          </Button>
        </div>
      </Specimen>
    </KitGroup>
  );
}
