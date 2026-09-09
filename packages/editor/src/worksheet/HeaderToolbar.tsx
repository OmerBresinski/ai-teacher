import { MAX_CRITERIA } from "@tj/domain/documents";
import { Label, Switch } from "@tj/ui";
import { ListChecks, Plus } from "lucide-react";
import { useId } from "react";
import { Panel, PanelSeparator } from "../kit/Panel";
import { Segmented } from "../kit/Segmented";
import { BarButton, ICON_SM } from "../lesson/toolbar/shared";
import {
  addCriterion,
  setHeader,
  setIncludeAnswerKey,
  setPageSize,
  setSelfAssessment,
} from "./reducers";
import { useTypingSession, useWorksheet, useWorksheetHistoryApi } from "./worksheet-context";

/*
 * The toolbar over the selected header (TeachDeck `components/v2/worksheet/HeaderToolbar.tsx`):
 * which rules print (Name / Date / Class), the objective line, a new success criterion, the paper
 * size, and the two sheet-wide switches — the printed answer key and self-assessment strip. (The
 * on-screen "Show answers" is a view, not a document flag: it lives on the top bar, TEACH-195.) Everything here is
 * a discrete click, so each is its own undo entry; the typing session is closed first.
 */

const FIELDS = [
  ["showName", "Name"],
  ["showDate", "Date"],
  ["showClass", "Class"],
] as const;

const SIZES = [
  { value: "A4", label: "A4" },
  { value: "Letter", label: "Letter" },
] as const;

export function HeaderToolbar() {
  const worksheet = useWorksheet();
  const { dispatch } = useWorksheetHistoryApi();
  const typing = useTypingSession();
  const ids = useId();
  const { header } = worksheet;
  const criteria = header.criteria ?? [];

  const click = (fn: () => void) => {
    typing.end();
    fn();
  };

  return (
    <div className="ws-toolbar" data-header-toolbar>
      <Panel as="bar" role="toolbar" aria-label="Worksheet header">
        {FIELDS.map(([flag, label]) => (
          <span key={flag} className="inline-flex items-center gap-1.5 px-1">
            <Switch
              id={`${ids}-${flag}`}
              checked={header[flag]}
              onCheckedChange={(on) => click(() => dispatch(setHeader, { [flag]: on }))}
            />
            <Label htmlFor={`${ids}-${flag}`} className="text-body">
              {label}
            </Label>
          </span>
        ))}
        <PanelSeparator />
        <BarButton
          disabled={header.subtitle !== undefined}
          onClick={() => click(() => dispatch(setHeader, { subtitle: "" }))}
        >
          <Plus {...ICON_SM} aria-hidden />
          Objective
        </BarButton>
        <BarButton
          disabled={criteria.length >= MAX_CRITERIA}
          onClick={() => click(() => dispatch(addCriterion, criteria.length - 1))}
        >
          <ListChecks {...ICON_SM} aria-hidden />
          Criterion
        </BarButton>
        <PanelSeparator />
        <Segmented
          aria-label="Page size"
          value={worksheet.pageSize}
          options={SIZES.map((s) => ({ value: s.value, label: s.label }))}
          onChange={(size) => click(() => dispatch(setPageSize, size))}
        />
        <PanelSeparator />
        <span className="inline-flex items-center gap-1.5 px-1">
          <Switch
            id={`${ids}-key`}
            checked={worksheet.includeAnswerKey}
            onCheckedChange={(on) => click(() => dispatch(setIncludeAnswerKey, on))}
          />
          <Label htmlFor={`${ids}-key`} className="text-body">
            Print answer key
          </Label>
        </span>
        <span className="inline-flex items-center gap-1.5 px-1">
          <Switch
            id={`${ids}-rag`}
            checked={worksheet.selfAssessment ?? false}
            onCheckedChange={(on) => click(() => dispatch(setSelfAssessment, on))}
          />
          <Label htmlFor={`${ids}-rag`} className="text-body">
            Self-assessment
          </Label>
        </span>
      </Panel>
    </div>
  );
}
