import { newLesson } from "@tj/editor";
import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardOverlay,
  CardTitle,
  Display,
  EmptyState,
  IconButton,
  PageTitle,
  SectionHeading,
  Stack,
  StatusPill,
} from "@tj/ui";
import { MoreHorizontal, Plus } from "lucide-react";
import { useState } from "react";
import { LessonThumb } from "@/components/lesson-thumb";
import { KitGroup, Specimen, Variant } from "./frame";

const KIT_COVER = newLesson("Fractions").slides[0] ?? null;

const stackSheets = ["front", "near", "far"] as const;

export function Content() {
  const [title, setTitle] = useState("Photosynthesis");
  return (
    <KitGroup
      id="content"
      title="Content"
      rule="The active display face stays on page titles, dialog titles, empty-state headlines and Display. Section headings use the UI face with the count in ink-3. A pill has one boundary: tint or hairline, never both."
    >
      <Specimen
        name="StatusPill, one per context"
        note="Where the pill sits decides its dress: tint in a header, hairline over a picture, dot and text in a row."
        bleed
      >
        <div className="grid w-full gap-6 sm:grid-cols-3">
          <Variant label="In a header">
            <div className="flex items-center gap-3 rounded-card border border-border bg-card px-4 py-3">
              <span className="text-body font-semibold whitespace-nowrap">The water cycle</span>
              <StatusPill tone="warning">Unsaved changes</StatusPill>
            </div>
          </Variant>
          <Variant label="Over a thumbnail">
            <div className="relative aspect-video w-full overflow-hidden rounded-card border border-border">
              <LessonThumb lesson={{ title: "Fractions", themeId: "chalk", cover: KIT_COVER }} />
              <div className="absolute top-2 left-2">
                <StatusPill opaque>Draft</StatusPill>
              </div>
            </div>
          </Variant>
          <Variant label="In a list row">
            <div className="flex w-full items-center justify-between rounded-card border border-border bg-card px-4 py-3">
              <span className="text-body">Fractions, week 3</span>
              <StatusPill quiet tone="success">
                Published
              </StatusPill>
            </div>
          </Variant>
        </div>
        <div className="flex flex-wrap items-center gap-6 pt-2">
          <Variant label="Needs attention">
            <StatusPill tone="danger" dot>
              Import failed
            </StatusPill>
          </Variant>
          <Variant label="New this week">
            <StatusPill tone="accent">New</StatusPill>
          </Variant>
          <Variant label="Count">
            <StatusPill>12 slides</StatusPill>
          </Variant>
        </div>
      </Specimen>
      <Specimen name="Card, default and contained" bleed>
        <div className="flex flex-wrap gap-6">
          <Card className="w-72">
            <CardHeader>
              <CardTitle>Year 4 Science</CardTitle>
              <CardDescription>Six lessons, two worksheets, one series.</CardDescription>
              <CardAction>
                <IconButton label="More" noTooltip>
                  <MoreHorizontal aria-hidden />
                </IconButton>
              </CardAction>
            </CardHeader>
            <CardContent>Next up: The water cycle, Tuesday.</CardContent>
            <CardFooter>
              <Button variant="primary" size="sm">
                Present series
              </Button>
            </CardFooter>
          </Card>
          <Card
            variant="contained"
            className="w-72"
            thumbnail={
              <LessonThumb lesson={{ title: "Fractions", themeId: "chalk", cover: KIT_COVER }} />
            }
            overlay={
              <CardOverlay>
                <StatusPill opaque>Draft</StatusPill>
              </CardOverlay>
            }
            heading="Fractions"
            meta="Year 4 · 6 slides"
          />
        </div>
      </Specimen>
      <Specimen name="SectionHeading, count and action" bleed>
        <SectionHeading
          className="w-full"
          count={4}
          action={
            <Button size="sm" variant="ghost">
              See all
            </Button>
          }
        >
          Recent lessons
        </SectionHeading>
      </Specimen>
      <Specimen name="Stack, one two and three sheets" bleed>
        <div className="flex flex-wrap gap-12 pt-7">
          {[1, 2, 3].map((count) => (
            <Variant
              key={count}
              label={`${count} ${count === 1 ? "lesson" : "lessons"} in the series`}
            >
              <Stack
                width={160}
                sheets={stackSheets
                  .slice(0, count)
                  .map((sheet) => <div key={sheet} className="size-full bg-brand-tint" />)}
              />
            </Variant>
          ))}
        </div>
      </Specimen>
      <Specimen name="EmptyState, accent quiet and stacked" bleed>
        <div className="grid gap-6 lg:grid-cols-3">
          <EmptyState
            icon={<Plus />}
            title="No lessons yet"
            body="Your first lesson takes about a minute."
            action={<Button variant="primary">New lesson</Button>}
          />
          <EmptyState
            icon={<Plus />}
            iconTone="quiet"
            title="Nothing matches"
            body="Try a shorter search, or check the spelling."
          />
          <EmptyState stacked title="Nothing in this series" body="Add a lesson to get started." />
        </div>
      </Specimen>
      <Specimen name="PageTitle, renameable" note="Double-click or F2 to rename.">
        <PageTitle label="Lesson title" renameLabel="Rename lesson" onCommit={setTitle}>
          {title}
        </PageTitle>
      </Specimen>
      <Specimen name="Display type" headingLevel={2}>
        {(
          [
            ["sm", "Dialog title, 20"],
            ["md", "Wordmark, 22"],
            ["lg", "Page title, 28"],
            ["xl", "Sign-in cover, 36"],
          ] as const
        ).map(([size, label]) => (
          <Variant key={size} label={label}>
            <Display as="h3" size={size}>
              Teaching Journey
            </Display>
          </Variant>
        ))}
      </Specimen>
    </KitGroup>
  );
}
