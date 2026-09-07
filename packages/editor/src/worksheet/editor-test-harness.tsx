import { mock } from "bun:test";
import { notifyManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { Worksheet } from "@tj/domain/documents";
import { TooltipProvider } from "@tj/ui";
import { starterWorksheet } from "../model/worksheet-factories";
import { WorksheetEditor, type WorksheetEditorProps } from "./WorksheetEditor";

/*
 * Shared harness for the worksheet editor tests: a QueryClient seeded with a worksheet, the
 * providers the shell needs, and `WorksheetEditor` mounted on it — the composition the route mounts,
 * so a test drives the real reducers, typing session, toolbars and autosave rather than stubs.
 */

export const KEY = ["library", "documents", "W1"] as const;

// TanStack batches observer notifications on a setTimeout; `act` cannot flush that, so the hook's
// `worksheet` would lag one tick behind the cache in assertions. Deliver them synchronously here.
notifyManager.setScheduler((callback) => callback());

export function renderWorksheetEditor(
  worksheet: Worksheet = starterWorksheet("Seed sheet"),
  overrides: Partial<WorksheetEditorProps> = {},
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(KEY, worksheet);
  const onSave = mock((_w: Worksheet) => Promise.resolve());
  const onBack = mock(() => {});
  const onPrint = mock(() => {});
  const utils = render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <WorksheetEditor
          worksheetId={worksheet.id}
          queryKey={KEY}
          queryFn={() => Promise.resolve(worksheet)}
          onSave={onSave}
          onBack={onBack}
          onPrint={onPrint}
          {...overrides}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  const read = () => client.getQueryData<Worksheet>(KEY) as Worksheet;
  return { client, onSave, onBack, onPrint, read, ...utils };
}

/** The row for a block, by id. */
export const row = (container: HTMLElement, id: string): HTMLElement => {
  const el = container.querySelector<HTMLElement>(`[data-block-id="${id}"]`);
  if (!el) throw new Error(`no row for ${id}`);
  return el;
};

export const pointer = (x = 0, y = 0, extra: Record<string, unknown> = {}) => ({
  clientX: x,
  clientY: y,
  button: 0,
  pointerId: 1,
  ...extra,
});
