import {
  Checkbox,
  IconButton,
  IconGroup,
  Label,
  RadioGroup,
  RadioGroupItem,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@tj/ui";
import { Grid2X2, List } from "lucide-react";
import { useState } from "react";
import { KitGroup, Specimen, Variant } from "./frame";

export function Choice() {
  const [checked, setChecked] = useState(true);
  const [tab, setTab] = useState("slides");
  return (
    <KitGroup
      id="choice"
      title="Choice"
      rule="Checkbox, radio and the off switch are the only controls that carry the control edge (#8A857B). The on state is the accent fill; the radio is round so it never reads as a checkbox."
    >
      <Specimen name="Switch" note="44 by 24, a 20px thumb. Off shows its edge, on shows the fill.">
        <Variant label="Answer key on">
          <div className="flex items-center gap-3">
            <Switch id="kit-switch-on" defaultChecked />
            <Label htmlFor="kit-switch-on">Print the answer key</Label>
          </div>
        </Variant>
        <Variant label="Self-assessment off">
          <div className="flex items-center gap-3">
            <Switch id="kit-switch-off" />
            <Label htmlFor="kit-switch-off">Self-assessment box</Label>
          </div>
        </Variant>
        <Variant label="Locked">
          <div className="flex items-center gap-3">
            <Switch id="kit-switch-locked" disabled />
            <Label htmlFor="kit-switch-locked">Objective on every slide</Label>
          </div>
        </Variant>
      </Specimen>
      <Specimen name="Checkbox" note="18px box, 12px glyph. Mixed means some of the set.">
        <Variant label="Not selected">
          <div className="flex items-center gap-2.5">
            <Checkbox id="kit-check-off" />
            <Label htmlFor="kit-check-off">Fractions, week 3</Label>
          </div>
        </Variant>
        <Variant label="Selected">
          <div className="flex items-center gap-2.5">
            <Checkbox
              id="kit-check-on"
              checked={checked}
              onCheckedChange={(value) => setChecked(value === true)}
            />
            <Label htmlFor="kit-check-on">The water cycle</Label>
          </div>
        </Variant>
        <Variant label="Some selected">
          <div className="flex items-center gap-2.5">
            <Checkbox id="kit-check-mixed" checked="indeterminate" />
            <Label htmlFor="kit-check-mixed">All lessons in Science</Label>
          </div>
        </Variant>
        <Variant label="Locked">
          <div className="flex items-center gap-2.5">
            <Checkbox id="kit-check-locked" disabled />
            <Label htmlFor="kit-check-locked">Shared with the department</Label>
          </div>
        </Variant>
      </Specimen>
      <Specimen name="RadioGroup" note="One of a set. A round 18px control with a 6px dot.">
        <RadioGroup defaultValue="portrait" aria-label="Page orientation">
          <div className="flex items-center gap-2.5">
            <RadioGroupItem value="portrait" id="radio-portrait" />
            <Label htmlFor="radio-portrait">Portrait</Label>
          </div>
          <div className="flex items-center gap-2.5">
            <RadioGroupItem value="landscape" id="radio-landscape" />
            <Label htmlFor="radio-landscape">Landscape</Label>
          </div>
        </RadioGroup>
      </Specimen>
      <Specimen
        name="IconGroup"
        note="A hairlined pair on the paper; the active member takes the wash."
      >
        <IconGroup aria-label="Library view">
          <IconButton label="Grid view" active noTooltip>
            <Grid2X2 aria-hidden />
          </IconButton>
          <IconButton label="List view" noTooltip>
            <List aria-hidden />
          </IconButton>
        </IconGroup>
      </Specimen>
      <Specimen name="Tabs" note="The active label is ink; the underline carries the accent." bleed>
        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <TabsList>
            <TabsTrigger value="slides">Slides</TabsTrigger>
            <TabsTrigger value="notes">Speaker notes</TabsTrigger>
          </TabsList>
          <TabsContent value="slides" className="rounded-control bg-secondary p-3 text-body">
            Twelve slides, last edited today.
          </TabsContent>
          <TabsContent value="notes" className="rounded-control bg-secondary p-3 text-body">
            Ask the class where rain comes from before slide 2.
          </TabsContent>
        </Tabs>
      </Specimen>
    </KitGroup>
  );
}
