import type { LessonFacts, Theme, Worksheet, WorksheetBlock } from "@tj/domain/documents";
import {
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  StatusPill,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@tj/ui";
import { type KeyboardEvent, useMemo, useRef, useState } from "react";
import {
  JOBS,
  type Job,
  WORKSHEET_RECIPES,
  type WorksheetRecipe,
} from "../model/worksheet-recipes";
import { BLOCK_GROUPS, BLOCK_SPECS, type BlockSpec } from "./block-types";
import { estimateMinutes, pageMetrics } from "./metrics";
import { buildFlow, type WorksheetPage } from "./paginate";
import { Sheet } from "./Sheet";
import { useFitScale } from "./WorksheetThumb";

/*
 * "Add a block" (TEACH-183; Worksheets and activities rulings 46 to 55): one dialog from the
 * "Add block" pill and the gutter plus, with two tabs. Sections are the nine recipes as cards,
 * each with a live miniature of the sheet it would add, built from the lesson's facts when the
 * sheet has them and from placeholder copy when it does not; the six job chips filter them. Blocks
 * are the eighteen block rows (fifteen types, headings twice, True or false and Sorting table) with the slash menu's descriptions. Picking hands the blocks back to
 * the editor, which inserts them as one undo step.
 */

export type AddBlockTab = "sections" | "blocks";

export type AddBlockDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The sheet the miniatures borrow their header, theme and paper from. */
  worksheet: Worksheet;
  theme: Theme;
  /** The lesson's facts, when the sheet's lesson has them; the placeholder build otherwise. */
  facts?: LessonFacts;
  onPickRecipe: (recipe: WorksheetRecipe, blocks: WorksheetBlock[]) => void;
  onPickBlock: (spec: BlockSpec) => void;
  initialTab?: AddBlockTab;
};

/** The miniature's scale: an A4 page comes out about 175px wide. */
export const MINIATURE_SCALE = 0.22;

export function AddBlockDialog({
  open,
  onOpenChange,
  worksheet,
  theme,
  facts,
  onPickRecipe,
  onPickBlock,
  initialTab = "sections",
}: AddBlockDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="ws-add-dialog" data-add-block-dialog>
        <DialogHeader>
          <DialogTitle>Add a block</DialogTitle>
          <DialogDescription>
            {facts
              ? "Sections are built from this lesson. Blocks are empty."
              : "Sections come with placeholder text to replace. Blocks are empty."}
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <AddBlockBody
            worksheet={worksheet}
            theme={theme}
            facts={facts}
            onPickRecipe={onPickRecipe}
            onPickBlock={onPickBlock}
            initialTab={initialTab}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** Mounted only while open, so every opening builds fresh blocks (fresh ids) and resets the filter. */
function AddBlockBody({
  worksheet,
  theme,
  facts,
  onPickRecipe,
  onPickBlock,
  initialTab,
}: Omit<AddBlockDialogProps, "open" | "onOpenChange"> & { initialTab: AddBlockTab }) {
  const [job, setJob] = useState<Job | null>(null);
  const built = useMemo(
    () => WORKSHEET_RECIPES.map((recipe) => ({ recipe, blocks: recipe.build(facts) })),
    [facts],
  );
  const shown = job ? built.filter(({ recipe }) => recipe.jobs.includes(job)) : built;

  return (
    <Tabs defaultValue={initialTab} className="ws-add-tabs">
      <TabsList aria-label="What to add">
        <TabsTrigger value="sections">Sections</TabsTrigger>
        <TabsTrigger value="blocks">Blocks</TabsTrigger>
      </TabsList>

      <TabsContent value="sections" className="ws-add-panel">
        <fieldset className="ws-job-chips">
          <legend className="sr-only">Filter sections by job</legend>
          {JOBS.map((j) => (
            <button
              key={j.id}
              type="button"
              aria-pressed={job === j.id}
              className="ws-job-chip"
              onClick={() => setJob((current) => (current === j.id ? null : j.id))}
            >
              {j.label}
            </button>
          ))}
        </fieldset>
        <ul className="ws-recipe-grid" aria-label="Sections">
          {shown.map(({ recipe, blocks }) => (
            <RecipeCard
              key={recipe.id}
              recipe={recipe}
              blocks={blocks}
              worksheet={worksheet}
              theme={theme}
              onPick={() => onPickRecipe(recipe, blocks)}
            />
          ))}
        </ul>
      </TabsContent>

      <TabsContent value="blocks" className="ws-add-panel">
        {BLOCK_GROUPS.map((group) => (
          <section key={group} aria-label={group} className="ws-block-group">
            <h3 className="ws-block-group-title">{group}</h3>
            <ul className="ws-block-grid">
              {BLOCK_SPECS.filter((spec) => spec.group === group).map((spec) => (
                <li key={spec.id}>
                  <button type="button" className="ws-block-pick" onClick={() => onPickBlock(spec)}>
                    <span className="ws-block-pick-icon">{spec.icon}</span>
                    <span className="min-w-0">
                      <span className="block text-body text-foreground">{spec.label}</span>
                      <span className="block text-meta text-ink-3">{spec.description}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </TabsContent>
    </Tabs>
  );
}

export type RecipeCardProps = {
  recipe: WorksheetRecipe;
  blocks: WorksheetBlock[];
  /** The sheet the miniature borrows its header, theme and paper from. */
  worksheet: Worksheet;
  theme: Theme;
  onPick: () => void;
  /**
   * The creation flow (TEACH-184) selects a card and continues from a bar, so a card can be the
   * chosen one (`aria-pressed`) and one card carries the Suggested pill. The dialog picks at once
   * and passes neither.
   */
  selected?: boolean;
  suggested?: boolean;
  onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
  /** Size the miniature to the card's inner width (the page's wider cards); the dialog keeps 175px. */
  fitMiniature?: boolean;
};

/** One recipe as a card: the live miniature, the name and line, the minutes pill and the jobs. */
export function RecipeCard({
  recipe,
  blocks,
  worksheet,
  theme,
  onPick,
  selected,
  suggested = false,
  onKeyDown,
  fitMiniature = false,
}: RecipeCardProps) {
  const minutes = estimateMinutes(blocks);
  const jobs = recipe.jobs.map((id) => JOBS.find((j) => j.id === id)?.label ?? id).join(", ");
  const label = `${recipe.name}. ${recipe.line} ${jobs}. About ${minutes} minutes.${
    suggested ? " Suggested." : ""
  }`;
  return (
    <li
      className="ws-recipe-card"
      data-recipe={recipe.id}
      data-selected={selected === undefined ? undefined : selected}
    >
      <RecipeMiniature blocks={blocks} worksheet={worksheet} theme={theme} fit={fitMiniature} />
      {/* The button is the whole card (its ::after covers it); the miniature is decoration. */}
      <button
        type="button"
        className="ws-recipe-pick"
        aria-label={label}
        aria-pressed={selected}
        onClick={onPick}
        onKeyDown={onKeyDown}
      >
        <span className="block truncate font-semibold text-body text-foreground">
          {recipe.name}
        </span>
        <span className="ws-recipe-line">{recipe.line}</span>
      </button>
      <span className="ws-recipe-meta">
        <StatusPill>{`about ${minutes} min`}</StatusPill>
        {/* Opaque: brand text on the card clears 4.5:1; on the tint it does not. */}
        {suggested ? (
          <StatusPill tone="accent" opaque>
            Suggested
          </StatusPill>
        ) : null}
        <span className="truncate text-meta text-ink-3">{jobs}</span>
      </span>
    </li>
  );
}

/** The clipped height of a miniature at `MINIATURE_SCALE`; a fitted one keeps the proportion. */
const MINIATURE_HEIGHT = 150;

/**
 * The real `Sheet`, at `MINIATURE_SCALE`, in greyscale, clipped to the card: the top of the page
 * the recipe would make, with this sheet's own header. One page, unpaginated: a card shows the
 * start of the section, not every page of it. With `fit` the miniature measures its own width
 * (a `ResizeObserver`) and scales the page to fill it, keeping the same clipped proportion, so
 * the creation flow's wider cards show the sheet edge to edge (TEACH-184).
 */
export function RecipeMiniature({
  blocks,
  worksheet,
  theme,
  className,
  fit = false,
}: {
  blocks: WorksheetBlock[];
  worksheet: Worksheet;
  theme: Theme;
  className?: string;
  fit?: boolean;
}) {
  const sheet = useMemo<Worksheet>(
    () => ({ ...worksheet, blocks, selfAssessment: false }),
    [worksheet, blocks],
  );
  const pages = useMemo<WorksheetPage[]>(
    () => [{ index: 0, items: buildFlow(sheet, false) }],
    [sheet],
  );
  const pageW = pageMetrics(worksheet.pageSize).page.w;
  const ref = useRef<HTMLDivElement>(null);
  const fitted = useFitScale(ref, pageW);
  const scale = fit && fitted ? fitted : MINIATURE_SCALE;
  const style = fit
    ? { width: "100%", height: `${(MINIATURE_HEIGHT * scale) / MINIATURE_SCALE}px` }
    : { width: `${pageW * MINIATURE_SCALE}pt` };
  return (
    <div ref={ref} className={cn("ws-mini", className)} style={style} aria-hidden>
      <div
        className="ws-mini-scale"
        style={{ transform: `scale(${scale})`, transformOrigin: "top left" }}
      >
        <Sheet worksheet={sheet} theme={theme} pages={pages} mode="print" />
      </div>
    </div>
  );
}
