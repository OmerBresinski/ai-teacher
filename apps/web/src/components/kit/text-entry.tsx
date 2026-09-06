import {
  Input,
  Label,
  SearchInput,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@tj/ui";
import { useState } from "react";
import { KitGroup, Specimen, Variant } from "./frame";

export function TextEntry() {
  const [search, setSearch] = useState("");
  return (
    <KitGroup id="text-entry" title="Text entry">
      <Specimen name="SearchInput, empty and filled" bleed>
        <Variant label="Empty">
          <SearchInput
            label="Search the kit"
            placeholder="Search components"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </Variant>
        <Variant label="Filled">
          <SearchInput
            label="Search the kit, filled"
            placeholder="Search components"
            value="Button"
            onChange={() => {}}
            onClear={() => {}}
          />
        </Variant>
      </Specimen>
      <Specimen name="Input" note="Rest, invalid and disabled native input states.">
        <Variant label="Rest">
          <Input aria-label="Lesson title" className="w-56" placeholder="Untitled lesson" />
        </Variant>
        <Variant label="Invalid">
          <Input
            aria-label="Invalid lesson title"
            className="w-56"
            aria-invalid
            defaultValue="Already taken"
          />
        </Variant>
        <Variant label="Disabled">
          <Input
            aria-label="Disabled lesson title"
            className="w-56"
            defaultValue="Locked"
            disabled
          />
        </Variant>
      </Specimen>
      <Specimen name="Textarea" note="Long-form text, invalid and disabled states.">
        <Variant label="Rest">
          <Textarea aria-label="Notes" className="w-64" placeholder="Notes for this lesson" />
        </Variant>
        <Variant label="Invalid">
          <Textarea
            aria-label="Invalid notes"
            className="w-64"
            aria-invalid
            defaultValue="Too long."
          />
        </Variant>
        <Variant label="Disabled">
          <Textarea
            aria-label="Disabled notes"
            className="w-64"
            disabled
            defaultValue="Locked notes"
          />
        </Variant>
      </Specimen>
      <Specimen name="Select" note="Radix select with a label, group and separator.">
        <Select defaultValue="lesson">
          <SelectTrigger aria-label="Document type">
            <SelectValue placeholder="Choose a type" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Document type</SelectLabel>
              <SelectItem value="lesson">Lesson</SelectItem>
              <SelectItem value="worksheet">Worksheet</SelectItem>
              <SelectSeparator />
              <SelectItem value="series">Series</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </Specimen>
      <Specimen name="Label with field">
        <div className="grid gap-2">
          <Label htmlFor="kit-labelled-input">Lesson title</Label>
          <Input id="kit-labelled-input" className="w-64" placeholder="Untitled lesson" />
        </div>
      </Specimen>
    </KitGroup>
  );
}
