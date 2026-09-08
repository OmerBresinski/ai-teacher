import {
  ActionBar,
  Button,
  EditableListRow,
  MinutesStepper,
  PhaseStrip,
  Progress,
  QuestionShell,
  StepRail,
} from "@tj/ui";
import { GripVertical } from "lucide-react";
import { useState } from "react";
import { KitGroup, Specimen, Variant } from "./frame";

const STEPS = [
  { id: "objectives", label: "Objectives" },
  { id: "shape", label: "Shape of the lesson" },
  { id: "words", label: "Words they will need" },
  { id: "worksheet", label: "Worksheet" },
  { id: "summary", label: "Summary" },
];

export function Steps() {
  const [minutes, setMinutes] = useState(8);
  const [phases, setPhases] = useState([
    { id: "s1", label: "Title", minutes: 2 },
    { id: "s2", label: "Objectives", minutes: 3 },
    { id: "s3", label: "Starter", minutes: 5 },
    { id: "s4", label: "Explain", minutes: 12 },
    { id: "s5", label: "Exit ticket", minutes: 6 },
  ]);
  const [selected, setSelected] = useState<string | null>("s4");
  const selectedPhase = phases.find((phase) => phase.id === selected);
  const [text, setText] = useState("Describe the arrangement of particles in a solid");
  return (
    <KitGroup
      id="steps"
      title="Steps"
      rule="One question per screen, one primary per bar. Every section reads Suggested until the teacher touches it, then Yours. Phase blocks are sized by their minutes and never narrower than one word."
    >
      <Specimen
        name="StepRail"
        note="A nav of steps: aria-current on the current one, a tick on completed ones, N of M in text."
      >
        <Variant label="Vertical">
          <StepRail
            steps={STEPS}
            current="words"
            done={["objectives", "shape"]}
            onSelect={() => {}}
            className="w-56"
          />
        </Variant>
        <Variant label="Horizontal, read-only">
          <StepRail steps={STEPS} current="shape" done={["objectives"]} orientation="horizontal" />
        </Variant>
      </Specimen>
      <Specimen
        name="QuestionShell"
        note="One question in display type, help under it, the control, a footer slot. Rows arrive with --stagger."
      >
        <QuestionShell
          eyebrow="1 of 5"
          question="What should pupils be able to do by the end?"
          help="One line each, up to four. Edit any line; the objectives slide follows."
          footer={
            <>
              <Button>Continue</Button>
              <Button variant="ghost">Looks right, generate</Button>
            </>
          }
          className="max-w-xl"
        >
          <ul className="flex flex-col gap-2">
            <EditableListRow
              mark="yours"
              leading={<GripVertical aria-hidden size={16} className="text-ink-3" />}
              field={{ value: text, onChange: setText, label: "Objective 1" }}
              onRemove={() => {}}
              removeLabel="Remove objective 1"
              className="motion-safe:animate-arrive"
              style={{ animationDelay: "calc(var(--stagger) * 0)" }}
            />
            <EditableListRow
              mark="suggested"
              leading={<GripVertical aria-hidden size={16} className="text-ink-3" />}
              field={{
                value: "Explain melting and freezing as changes of state",
                onChange: () => {},
                label: "Objective 2",
              }}
              trailing={<MinutesStepper value={minutes} onChange={setMinutes} label="Minutes" />}
              onRemove={() => {}}
              removeLabel="Remove objective 2"
              className="motion-safe:animate-arrive"
              style={{ animationDelay: "calc(var(--stagger) * 1)" }}
            />
          </ul>
        </QuestionShell>
      </Specimen>
      <Specimen
        name="EditableListRow"
        note="A one-line textarea that grows with its content, an optional second field, a trailing control, remove."
      >
        <ul className="flex max-w-xl flex-col gap-2">
          <EditableListRow
            field={{ value: "Particle", onChange: () => {}, label: "Term 1" }}
            secondary={{
              value: "A very small piece of a substance, too small to see.",
              onChange: () => {},
              label: "Definition 1",
              multiline: true,
            }}
            mark="suggested"
            onRemove={() => {}}
            removeLabel="Remove term 1"
          />
        </ul>
      </Specimen>
      <Specimen
        name="MinutesStepper"
        note="32px group: minus, typed field, plus. Arrows step, Shift by five."
      >
        <Variant label="Default">
          <MinutesStepper value={minutes} onChange={setMinutes} label="Minutes for Starter" />
        </Variant>
        <Variant label="Disabled">
          <MinutesStepper value={5} onChange={() => {}} label="Minutes, disabled" disabled />
        </Variant>
      </Specimen>
      <Specimen
        name="PhaseStrip"
        note="The shape of a lesson: blocks sized by minutes. Click or Enter opens the detail, Escape closes it, Alt+Arrow or a drag moves a block."
      >
        <PhaseStrip
          className="max-w-xl"
          phases={phases}
          selectedId={selected}
          onSelect={setSelected}
          onMove={(from, to) =>
            setPhases((current) => {
              const next = [...current];
              const [item] = next.splice(from, 1);
              if (item) next.splice(to, 0, item);
              return next;
            })
          }
          detail={
            selectedPhase ? (
              <>
                <span className="text-body font-medium">{selectedPhase.label}</span>
                <MinutesStepper
                  value={selectedPhase.minutes}
                  onChange={(value) =>
                    setPhases((current) =>
                      current.map((phase) =>
                        phase.id === selectedPhase.id ? { ...phase, minutes: value } : phase,
                      ),
                    )
                  }
                  label={`Minutes for ${selectedPhase.label}`}
                />
              </>
            ) : null
          }
        />
      </Specimen>
      <Specimen
        name="ActionBar"
        note="Sticky under a step: one labelled primary (36px), quiet actions beside it, a hint on the right."
      >
        <ActionBar
          sticky={false}
          primary={<Button size="lg">Continue</Button>}
          trailing={<span className="text-meta text-ink-3">Enter continues</span>}
          className="max-w-xl"
        >
          <Button variant="ghost">Back</Button>
        </ActionBar>
      </Specimen>
      <Specimen
        name="Progress"
        note="Ink fill on the control-border track; replaces the native element."
      >
        <Variant label="40%">
          <Progress value={40} label="Generating" />
        </Variant>
        <Variant label="Indeterminate">
          <Progress label="Working" />
        </Variant>
      </Specimen>
    </KitGroup>
  );
}
