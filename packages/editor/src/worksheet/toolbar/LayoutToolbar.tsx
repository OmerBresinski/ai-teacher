import { Label, Switch } from "@tj/ui";
import { Columns3, Plus, Rows3, X } from "lucide-react";
import { useId } from "react";
import { Segmented } from "../../kit/Segmented";
import { useBlockWrites } from "../worksheet-context";
import { BarButton, type BlockOf, ICON_SM, NumberField } from "./shared";

/*
 * The layout family (TeachDeck `BlockToolbar.tsx` heading / image / table sections): heading
 * level, image width, table rows and columns with a header-row switch.
 */

type Heading = BlockOf<"heading">;
type Image = BlockOf<"image">;
type Table = BlockOf<"table">;

const LEVELS = [
  { value: "1", label: "Heading" },
  { value: "2", label: "Subheading" },
] as const;

const MAX_ROWS = 20;
const MAX_COLS = 6;

export function LayoutToolbar({ block }: { block: Heading | Image | Table }) {
  switch (block.type) {
    case "heading":
      return <HeadingFields block={block} />;
    case "image":
      return (
        <NumberField<Image>
          id={block.id}
          label="Width"
          unit="%"
          value={block.widthPct}
          min={20}
          max={100}
          step={5}
          onValue={(widthPct, b) => {
            b.widthPct = widthPct;
          }}
        />
      );
    case "table":
      return <TableFields block={block} />;
  }
}

function HeadingFields({ block }: { block: Heading }) {
  const { commit } = useBlockWrites();
  return (
    <Segmented
      aria-label="Heading level"
      value={String(block.level) as "1" | "2"}
      options={LEVELS.map((l) => ({ value: l.value, label: l.label }))}
      onChange={(level) =>
        commit<Heading>(block.id, (b) => {
          b.level = level === "2" ? 2 : 1;
        })
      }
    />
  );
}

function TableFields({ block }: { block: Table }) {
  const { commit } = useBlockWrites();
  const headerId = useId();
  const cols = block.rows[0]?.length ?? 0;
  const rows = block.rows.length;
  const minRows = block.header ? 2 : 1;
  return (
    <>
      <span className="inline-flex items-center gap-0.5">
        <Rows3 {...ICON_SM} aria-hidden className="text-ink-3" />
        <BarButton
          aria-label="Add row"
          disabled={rows >= MAX_ROWS}
          onClick={() =>
            commit<Table>(block.id, (b) => {
              b.rows.push(Array.from({ length: cols }, () => ""));
            })
          }
        >
          <Plus {...ICON_SM} aria-hidden />
        </BarButton>
        <BarButton
          aria-label="Remove row"
          disabled={rows <= minRows}
          onClick={() =>
            commit<Table>(block.id, (b) => {
              b.rows.pop();
            })
          }
        >
          <X {...ICON_SM} aria-hidden />
        </BarButton>
      </span>
      <span className="inline-flex items-center gap-0.5">
        <Columns3 {...ICON_SM} aria-hidden className="text-ink-3" />
        <BarButton
          aria-label="Add column"
          disabled={cols >= MAX_COLS}
          onClick={() =>
            commit<Table>(block.id, (b) => {
              for (const row of b.rows) row.push("");
            })
          }
        >
          <Plus {...ICON_SM} aria-hidden />
        </BarButton>
        <BarButton
          aria-label="Remove column"
          disabled={cols <= 1}
          onClick={() =>
            commit<Table>(block.id, (b) => {
              for (const row of b.rows) row.pop();
            })
          }
        >
          <X {...ICON_SM} aria-hidden />
        </BarButton>
      </span>
      <span className="inline-flex items-center gap-1.5 pl-1">
        <Switch
          id={headerId}
          checked={block.header ?? false}
          onCheckedChange={(header) =>
            commit<Table>(block.id, (b) => {
              b.header = header;
            })
          }
        />
        <Label htmlFor={headerId} className="text-body">
          Header row
        </Label>
      </span>
    </>
  );
}
