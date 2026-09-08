import { CropBar } from "@tj/editor/lesson";
import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Kbd,
  Tooltip,
} from "@tj/ui";
import { ChevronDown, Copy, Trash2 } from "lucide-react";
import { useState } from "react";
import { KitGroup, Specimen, Variant } from "./frame";

/** The crop bar with live values, so the popovers and the readouts can be tried. */
function CropBarSpecimen() {
  const [zoom, setZoom] = useState(1.5);
  const [straighten, setStraighten] = useState(-4);
  const pristine = zoom === 1 && straighten === 0;
  return (
    <CropBar
      zoom={zoom}
      straighten={straighten}
      pristine={pristine}
      onZoom={setZoom}
      onStraighten={setStraighten}
      onRotate={() => {}}
      onFlipH={() => {}}
      onFlipV={() => {}}
      onReset={() => {
        setZoom(1);
        setStraighten(0);
      }}
      onDone={() => {}}
    />
  );
}

export function Overlays() {
  const [layout, setLayout] = useState("grid");
  const [showMeta, setShowMeta] = useState(true);
  return (
    <KitGroup
      id="overlays"
      title="Overlays"
      rule="Menus and popovers float on the panel shadow with a hairline at radius 12. Shortcuts sit at the right in Kbd; one destructive row, at the foot, after a separator."
    >
      <Specimen
        name="DropdownMenu"
        note="Items, shortcut, destructive action, separator, checkbox, radio and sub menu."
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary">
              Lesson
              <ChevronDown aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>The water cycle</DropdownMenuLabel>
            <DropdownMenuGroup>
              <DropdownMenuItem>
                <Copy aria-hidden />
                Duplicate <DropdownMenuShortcut>⌘D</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuCheckboxItem checked={showMeta} onCheckedChange={setShowMeta}>
                Show year group
              </DropdownMenuCheckboxItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup value={layout} onValueChange={setLayout}>
              <DropdownMenuRadioItem value="grid">Grid</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="list">List</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Move to</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem>Science</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive>
              <Trash2 aria-hidden />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Specimen>
      <Specimen
        name="Crop bar"
        note="Floats above a picture in crop mode in place of the image bar. Two value controls open a slider with the value bubble and read in tabular figures; three glyphs turn and flip; Reset is the text action and Done the one primary."
      >
        <CropBarSpecimen />
      </Specimen>
      <Specimen name="Tooltip with shortcut" note="The name of a glyph, and its key.">
        <Tooltip label="Copy link" shortcut="⌘C">
          <Button variant="secondary">
            Copy link <Kbd>⌘C</Kbd>
          </Button>
        </Tooltip>
      </Specimen>
      <Specimen name="DropdownMenu state" note="What the menu above last set.">
        <Variant label="Library view">{layout === "grid" ? "Grid" : "List"}</Variant>
        <Variant label="Year group">{showMeta ? "Shown" : "Hidden"}</Variant>
      </Specimen>
    </KitGroup>
  );
}
