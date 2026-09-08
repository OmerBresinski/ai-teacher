import {
  Button,
  Kbd,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
  Slider,
} from "@tj/ui";
import { useState } from "react";
import { KitGroup, Specimen, Variant } from "./frame";

export function Value() {
  return (
    <KitGroup
      id="value"
      title="Value"
      rule="A value reads in tabular figures beside its control. The slider track is a hairline, the fill is ink; the accent is kept for the focus band. The bubble reads the value while it moves; the readout beside it stays."
    >
      <Specimen
        name="Popover"
        note="A small anchored panel for settings that do not need a dialog."
      >
        <Popover>
          <PopoverAnchor asChild>
            <span />
          </PopoverAnchor>
          <PopoverTrigger asChild>
            <Button variant="secondary">Lesson settings</Button>
          </PopoverTrigger>
          <PopoverContent>
            <PopoverHeader>
              <PopoverTitle>Lesson settings</PopoverTitle>
              <PopoverDescription>Saved automatically.</PopoverDescription>
            </PopoverHeader>
            <p className="mt-3 text-body text-ink-2">
              Use <Kbd>⌘</Kbd> <Kbd>S</Kbd> to save now.
            </p>
          </PopoverContent>
        </Popover>
      </Specimen>
      <Specimen name="Status text" note="The save state in a bar, as text in the tone colour.">
        <Variant label="After a save">
          <span className="text-body text-success">Saved</span>
        </Variant>
        <Variant label="Something to check">
          <span className="text-body text-warning">Needs review</span>
        </Variant>
        <Variant label="Save failed">
          <span className="text-body text-destructive">Could not save</span>
        </Variant>
      </Specimen>
      <Specimen
        name="Slider"
        note="Ink fill on a control-border track; 32px row, 16px thumb. Drag or use the arrow keys to see the value bubble."
      >
        <Variant label="Zoom">
          <Slider
            aria-label="Zoom"
            defaultValue={[50]}
            valueLabel={(v) => `${v}%`}
            className="w-56"
          />
        </Variant>
        <Variant label="Font size, min and max">
          <Slider
            aria-label="Font size range"
            defaultValue={[20, 70]}
            valueLabel={(v) => `${v} pt`}
            className="w-56"
          />
        </Variant>
        <Variant label="Locked">
          <Slider
            aria-label="Opacity"
            defaultValue={[30]}
            valueLabel={(v) => `${v}%`}
            disabled
            className="w-56"
          />
        </Variant>
        <Variant label="Corner radius, with readout">
          <RadiusReadout />
        </Variant>
      </Specimen>
    </KitGroup>
  );
}

/** The readout beside the slider follows it: the exhibit is controlled so the number moves too. */
function RadiusReadout() {
  const [radius, setRadius] = useState(8);
  return (
    <div className="flex w-64 items-center gap-3">
      <Slider
        aria-label="Corner radius"
        value={[radius]}
        onValueChange={([v]) => setRadius(v ?? 0)}
        max={32}
        valueLabel={(v) => `${v} px`}
      />
      <span className="w-8 text-right text-meta text-ink-3 tabular-nums">{radius}</span>
    </div>
  );
}
