import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Separator,
  Slider,
  Switch,
} from "@tj/ui";
import { Pencil } from "lucide-react";
import { KitGroup, Specimen, Variant } from "./frame";

const swatches = [
  ["Background", "bg-background"],
  ["Card", "bg-card"],
  ["Secondary", "bg-secondary"],
  ["Canvas", "bg-canvas"],
  ["Primary", "bg-primary"],
  ["Brand text", "bg-brand-text"],
  ["Brand tint", "bg-brand-tint"],
  ["Success", "bg-success"],
  ["Warning", "bg-warning"],
  ["Destructive", "bg-destructive"],
] as const;

export function Foundations() {
  return (
    <KitGroup id="foundations" title="Foundations">
      <Specimen
        name="Surfaces, primary and status"
        note="Semantic palette tokens across every theme."
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {swatches.map(([label, className]) => (
            <div key={label} className="w-24">
              <div
                aria-hidden
                className={`h-12 rounded-control border border-border ${className}`}
              />
              <span className="mt-1 block text-meta text-ink-3">{label}</span>
            </div>
          ))}
        </div>
      </Specimen>
      <Specimen name="Ink ladder" note="Foreground tokens, from strongest to decorative.">
        {(
          [
            ["Foreground", "text-foreground"],
            ["Ink 2", "text-ink-2"],
            ["Ink 3", "text-ink-3"],
            ["Ink 4", "text-ink-4"],
          ] as const
        ).map(([label, className]) => (
          <Variant key={label} label={label}>
            {label === "Ink 4" ? (
              <span aria-hidden className="block size-8 rounded-chip bg-ink-4" />
            ) : (
              <span className={`text-[24px] font-semibold ${className}`}>Aa</span>
            )}
          </Variant>
        ))}
      </Specimen>
      <Specimen name="Hairlines" note="Faint, standard and control borders.">
        <div className="flex w-full flex-col gap-3">
          <Separator className="bg-border-faint" />
          <Separator className="bg-border" />
          <Separator className="bg-border-control" />
        </div>
      </Specimen>
      <Specimen name="Radii" note="Chip through face, labelled in pixels.">
        {(
          [
            ["Chip 6px", "rounded-chip"],
            ["Control 8px", "rounded-control"],
            ["Card 10px", "rounded-card"],
            ["Dialog 12px", "rounded-dialog"],
            ["Face 16px", "rounded-face"],
          ] as const
        ).map(([label, className]) => (
          <Variant key={label} label={label}>
            <span aria-hidden className={`block size-14 bg-brand-tint ${className}`} />
          </Variant>
        ))}
      </Specimen>
      <Specimen name="Elevation" note="Tokenized elevation stays legible on all three themes.">
        {(
          [
            ["Shadow 1", "shadow-1"],
            ["Shadow 2", "shadow-2"],
            ["Shadow 3", "shadow-3"],
          ] as const
        ).map(([label, className]) => (
          <Variant key={label} label={label}>
            <span aria-hidden className={`block size-20 rounded-card bg-card ${className}`} />
          </Variant>
        ))}
      </Specimen>
      <Specimen name="Type ladder" note="Eyebrow through display type.">
        <div className="space-y-2">
          <p className="text-eyebrow font-semibold tracking-wide text-ink-3 uppercase">Eyebrow</p>
          <p className="text-meta text-ink-3">Meta</p>
          <p className="text-body">Body</p>
          <p className="text-lead text-ink-2">Lead</p>
          <p className="font-display text-title">Title</p>
          <p className="font-display text-[28px] leading-9">Display</p>
        </div>
      </Specimen>
      <Specimen
        name="Stage"
        note="The present-mode scope (ADR 0022 §3): `tj-stage` remaps the tokens inside a subtree and stays dark in every theme. A portalled menu carries the class itself."
      >
        <div
          data-testid="kit-stage"
          className="tj-stage flex flex-wrap items-center gap-3 rounded-card bg-background p-4 text-foreground"
        >
          <Button>Present</Button>
          <Button variant="outline">Notes</Button>
          <IconButton label="Pen">
            <Pencil aria-hidden size={16} strokeWidth={1.5} />
          </IconButton>
          <Switch aria-label="Laser" defaultChecked />
          <Slider aria-label="Timer" defaultValue={[40]} className="w-40" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">Stage menu</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="tj-stage">
              <DropdownMenuItem>Overview</DropdownMenuItem>
              <DropdownMenuItem>Shortcuts</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <span className="text-meta text-muted-foreground">Muted on the stage ground</span>
        </div>
      </Specimen>
    </KitGroup>
  );
}
