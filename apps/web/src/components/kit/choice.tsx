import {
  Checkbox,
  IconButton,
  IconGroup,
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
  const [tab, setTab] = useState("first");
  return (
    <KitGroup id="choice" title="Choice">
      <Specimen name="Switch" note="Checked, unchecked and disabled states.">
        <Variant label="Checked">
          <Switch aria-label="Switch checked" checked />
        </Variant>
        <Variant label="Unchecked">
          <Switch aria-label="Switch unchecked" />
        </Variant>
        <Variant label="Disabled">
          <Switch aria-label="Switch disabled" disabled />
        </Variant>
      </Specimen>
      <Specimen name="Checkbox" note="Unchecked, checked, indeterminate and disabled states.">
        <Variant label="Unchecked">
          <Checkbox aria-label="Checkbox unchecked" />
        </Variant>
        <Variant label="Checked">
          <Checkbox
            aria-label="Checkbox checked"
            checked={checked}
            onCheckedChange={(value) => setChecked(value === true)}
          />
        </Variant>
        <Variant label="Indeterminate">
          <Checkbox aria-label="Checkbox indeterminate" checked="indeterminate" />
        </Variant>
        <Variant label="Disabled">
          <Checkbox aria-label="Checkbox disabled" disabled />
        </Variant>
      </Specimen>
      <Specimen name="RadioGroup">
        <RadioGroup defaultValue="one" aria-label="Kit radio group">
          <div className="flex items-center gap-2">
            <RadioGroupItem value="one" id="radio-one" />
            <label htmlFor="radio-one">One</label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="two" id="radio-two" />
            <label htmlFor="radio-two">Two</label>
          </div>
        </RadioGroup>
      </Specimen>
      <Specimen name="IconGroup">
        <IconGroup aria-label="Gallery view">
          <IconButton label="Grid view" active noTooltip>
            <Grid2X2 aria-hidden />
          </IconButton>
          <IconButton label="List view" noTooltip>
            <List aria-hidden />
          </IconButton>
        </IconGroup>
      </Specimen>
      <Specimen name="Tabs" bleed>
        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <TabsList>
            <TabsTrigger value="first">First</TabsTrigger>
            <TabsTrigger value="second">Second</TabsTrigger>
          </TabsList>
          <TabsContent value="first" className="rounded-control bg-secondary p-3 text-body">
            First panel
          </TabsContent>
          <TabsContent value="second" className="rounded-control bg-secondary p-3 text-body">
            Second panel
          </TabsContent>
        </Tabs>
      </Specimen>
    </KitGroup>
  );
}
