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
    </KitGroup>
  );
}
