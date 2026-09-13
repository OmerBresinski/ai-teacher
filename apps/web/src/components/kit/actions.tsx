import { Button, IconButton, IconGroup, Kbd, KbdGroup, Spinner, Tile } from "@tj/ui";
import { Copy, FileText, Layers, Plus, Presentation } from "lucide-react";
import { tokenLabel, useDesignValues } from "./design-values";
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
  const values = useDesignValues();
  return (
    <KitGroup
      id="actions"
      title="Actions"
      rule={`One primary action per bar. Compact controls use ${tokenLabel(values?.["--button-height-xs"], "28px")} and ${tokenLabel(values?.["--button-height"], "32px")}; standard controls use ${tokenLabel(values?.["--reading-control-height"] || values?.["--button-height-lg"], "36px")}. Ghost actions stay quieter beside a fill.`}
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
          <div className="flex flex-wrap gap-6">
            <Variant label="Unavailable">
              <Button variant="primary" disabled aria-describedby="kit-action-unavailable">
                Present
              </Button>
              <p id="kit-action-unavailable" className="text-meta text-ink-3">
                Add a slide to present this lesson.
              </p>
            </Variant>
            <Variant label="Working">
              <Button variant="primary" disabled aria-busy="true">
                <Spinner />
                Planning lesson…
              </Button>
            </Variant>
          </div>
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
