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
import { tokenLabel, useDesignValues } from "./design-values";
import { eyebrowClass, KitGroup, Specimen, Variant } from "./frame";

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
  const values = useDesignValues();
  const typeLabel = (token: "eyebrow" | "meta" | "body" | "lead", fallback: string) => {
    const [fallbackSize = "", fallbackLineHeight = ""] = fallback.split("/");
    return `${tokenLabel(values?.[`--text-${token}`], fallbackSize)}/${tokenLabel(
      values?.[`--text-${token}--line-height`],
      fallbackLineHeight,
    )}`;
  };
  const radii = [
    ["Key", "rounded-key", "--radius-key", "4px"],
    ["Chip", "rounded-chip", "--radius-chip", "6px"],
    ["Control", "rounded-control", "--radius-control", "8px"],
    ["Card", "rounded-card", "--radius-card", "10px"],
    ["Dialog", "rounded-dialog", "--radius-dialog", "12px"],
    ["Face", "rounded-face", "--radius-face", "16px"],
  ] as const;

  return (
    <KitGroup
      id="foundations"
      title="Foundations"
      rule={`The active semantic palette is the source of truth: background ${tokenLabel(values?.["--background"], "var(--background)")}, ink ${tokenLabel(values?.["--foreground"], "var(--foreground)")}, paper ${tokenLabel(values?.["--card"], "var(--card)")} and tint ${tokenLabel(values?.["--brand-tint"], "var(--brand-tint)")}. Change the development design preview or theme to inspect the applied tokens.`}
    >
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
      <Specimen name="Hairlines" note="Faint, standard, strong and control borders.">
        <div className="flex w-full flex-col gap-3">
          <Separator className="bg-border-faint" />
          <Separator className="bg-border" />
          <Separator className="bg-border-strong" />
          <Separator className="bg-border-control" />
        </div>
      </Specimen>
      <Specimen name="Radii" note="The named ladder, labelled from the applied CSS tokens.">
        {radii.map(([name, className, property, fallback]) => (
          <Variant key={name} label={`${name} ${tokenLabel(values?.[property], fallback)}`}>
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
            ["Slide", "shadow-slide"],
            ["Lift", "shadow-lift"],
          ] as const
        ).map(([label, className]) => (
          <Variant key={label} label={label}>
            <span aria-hidden className={`block size-20 rounded-card bg-card ${className}`} />
          </Variant>
        ))}
      </Specimen>
      <Specimen
        name="Type ladder"
        note={`UI: ${tokenLabel(values?.["--font-ui"], "system UI")}. Display: ${tokenLabel(values?.["--font-display"], "serif display")}. The preview preserves each design’s actual type tokens.`}
      >
        <div className="flex flex-col gap-2">
          <p className={eyebrowClass}>Eyebrow {typeLabel("eyebrow", "12px/16px")}, tracked</p>
          <p className="text-meta text-ink-3">
            Meta {typeLabel("meta", "13px/18px")}, the row under a title
          </p>
          <p className="text-body">Body {typeLabel("body", "14px/20px")}, labels and prose</p>
          <p className="text-lead text-ink-2">
            Lead {typeLabel("lead", "15px/22px")}, a dialog body
          </p>
          <p className="font-ui text-lead font-semibold">
            Section heading {typeLabel("lead", "15px/22px")}, semibold
          </p>
          <p className="font-display text-title">Dialog title, display 20</p>
          <p className="font-display text-[28px] leading-9 tracking-[-0.015em]">
            Page title, display 28
          </p>
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
          <Button variant="primary">Present</Button>
          <Button variant="outline">Notes</Button>
          <IconButton label="Pen" tooltipClassName="tj-stage">
            <Pencil aria-hidden size={16} strokeWidth={1.5} />
          </IconButton>
          <Switch aria-label="Laser pointer" defaultChecked />
          <Slider
            aria-label="Timer"
            defaultValue={[40]}
            valueLabel={(v) => `${v} min`}
            className="w-40"
          />
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
