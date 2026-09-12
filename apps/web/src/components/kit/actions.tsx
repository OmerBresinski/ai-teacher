import { Button, IconButton, IconGroup, Kbd, KbdGroup, Spinner, Tile } from "@tj/ui";
import { Copy, FileText, Layers, Plus, Presentation } from "lucide-react";
import { KitGroup, Specimen, Variant } from "./frame";

const buttonRows = [
  ["primary", "Primary, one per bar", "New lesson"],
  ["inverse", "Inverse, the quiet-strong action", "Present"],
  ["default", "Quiet, beside a primary", "Save a copy"],
  ["ghost", "Ghost, in bars and rows", "Duplicate"],
  ["link", "Link, inside prose", "See all lessons"],
  ["destructive", "Destructive, in a confirm footer only", "Delete lesson"],
] as const;

const buttonSizes = [
  ["sm", "Bar"],
  ["default", "Control"],
  ["lg", "Dialog"],
] as const;

export function Actions() {
  return (
    <KitGroup
      id="actions"
      title="Actions"
      rule="One primary per bar; every other action is text or ghost. Filled labels are 600, ghost and text labels 500. Controls sit on the 28, 32 and 36 ladder."
    >
      <Specimen
        name="Button, every variant and size"
        note="Semantic primary, inverse, quiet hairline, ghost, link and destructive treatments. The same verb at the bar, control and dialog rungs, then with a glyph."
      >
        <div className="space-y-4">
          {buttonRows.map(([variant, label, copy]) => (
            <Variant key={variant} label={label} grow>
              <div className="flex flex-wrap items-center gap-2">
                {buttonSizes.map(([size, rung]) => (
                  <Button key={size} variant={variant} size={size} aria-label={`${copy}, ${rung}`}>
                    {copy}
                  </Button>
                ))}
                <Button variant={variant} size="default">
                  <Plus aria-hidden />
                  {copy}
                </Button>
              </div>
            </Variant>
          ))}
          <Variant label="Nothing to do yet">
            <Button variant="primary" disabled>
              Present
            </Button>
          </Variant>
        </div>
      </Specimen>
      <Specimen name="IconButton, states" note="A glyph with a name; the tooltip carries it.">
        <Variant label="In a bar">
          <IconButton label="Copy link" size="sm" noTooltip>
            <Copy aria-hidden />
          </IconButton>
        </Variant>
        <Variant label="On a card">
          <IconButton label="Copy link" size="md" noTooltip>
            <Copy aria-hidden />
          </IconButton>
        </Variant>
        <Variant label="Open">
          <IconButton label="Copy link, open" active noTooltip>
            <Copy aria-hidden />
          </IconButton>
        </Variant>
      </Specimen>
      <Specimen name="IconGroup" note="Related glyphs share one hairline on the paper.">
        <IconGroup aria-label="Slide actions">
          <IconButton label="Duplicate slide" noTooltip>
            <Copy aria-hidden />
          </IconButton>
          <IconButton label="Add slide" noTooltip>
            <Plus aria-hidden />
          </IconButton>
        </IconGroup>
      </Specimen>
      <Specimen name="Tile, default and primary" bleed>
        <div className="grid w-full gap-3 sm:grid-cols-2">
          <Tile icon={<FileText aria-hidden />}>New worksheet</Tile>
          <Tile tone="primary" icon={<Presentation aria-hidden />}>
            New lesson
          </Tile>
          <Tile icon={<Layers aria-hidden />} disabled>
            New series
          </Tile>
        </div>
      </Specimen>
      <Specimen name="Kbd and Spinner" note="Keyboard hints and the pending state.">
        <Variant label="Shortcut">
          <KbdGroup>
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </KbdGroup>
        </Variant>
        <Variant label="Saving, in a bar">
          <Spinner size={16} />
        </Variant>
        <Variant label="Loading, on a card">
          <Spinner size={20} />
        </Variant>
      </Specimen>
    </KitGroup>
  );
}
