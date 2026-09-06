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
import { KitGroup, Specimen, Variant } from "./frame";

export function Value() {
  return (
    <KitGroup id="value" title="Value">
      <Specimen name="Popover, value detail" note="A compact value inspector and anchored status.">
        <Popover>
          <PopoverAnchor asChild>
            <span />
          </PopoverAnchor>
          <PopoverTrigger asChild>
            <Button>Open value inspector</Button>
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
      <Specimen name="Value status">
        <Variant label="Saved">
          <span className="text-body text-success">Saved</span>
        </Variant>
        <Variant label="Warning">
          <span className="text-body text-warning">Needs review</span>
        </Variant>
        <Variant label="Error">
          <span className="text-body text-destructive">Could not save</span>
        </Variant>
      </Specimen>
      <Specimen name="Slider" note="Ink fill on a control-border track; 32px row, 16px thumb.">
        <Variant label="Default">
          <Slider aria-label="Zoom" defaultValue={[50]} className="w-56" />
        </Variant>
        <Variant label="Range">
          <Slider aria-label="Font size range" defaultValue={[20, 70]} className="w-56" />
        </Variant>
        <Variant label="Disabled">
          <Slider aria-label="Opacity" defaultValue={[30]} disabled className="w-56" />
        </Variant>
        <Variant label="With value">
          <div className="flex w-64 items-center gap-3">
            <Slider aria-label="Corner radius" defaultValue={[8]} max={32} />
            <span className="w-8 text-right text-meta text-ink-3 tabular-nums">8</span>
          </div>
        </Variant>
      </Specimen>
    </KitGroup>
  );
}
