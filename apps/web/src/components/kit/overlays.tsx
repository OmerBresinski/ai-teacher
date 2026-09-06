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

export function Overlays() {
  const [layout, setLayout] = useState("grid");
  const [showMeta, setShowMeta] = useState(true);
  return (
    <KitGroup id="overlays" title="Overlays">
      <Specimen
        name="DropdownMenu"
        note="Items, shortcut, destructive action, separator, checkbox, radio and sub menu."
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button>
              <ChevronDown aria-hidden />
              Actions
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Lesson</DropdownMenuLabel>
            <DropdownMenuGroup>
              <DropdownMenuItem>
                <Copy aria-hidden />
                Duplicate <DropdownMenuShortcut>⌘D</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuCheckboxItem checked={showMeta} onCheckedChange={setShowMeta}>
                Show metadata
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
      <Specimen name="Tooltip with shortcut">
        <Tooltip label="Copy link" shortcut="⌘C">
          <Button variant="secondary">
            Hover for <Kbd>⌘C</Kbd>
          </Button>
        </Tooltip>
      </Specimen>
      <Specimen name="DropdownMenu states">
        <Variant label="Layout">Selected: {layout}</Variant>
        <Variant label="Metadata">{showMeta ? "Shown" : "Hidden"}</Variant>
      </Specimen>
    </KitGroup>
  );
}
