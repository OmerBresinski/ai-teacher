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

const stackSheets = ["front", "near", "far"] as const;

export function Content() {
  const [title, setTitle] = useState("Photosynthesis");
  return (
    <KitGroup id="content" title="Content">
      <Specimen
        name="StatusPill, all tones and opaque"
        note="States include dot and thumbnail-overlay treatments."
      >
        {(["neutral", "accent", "success", "warning", "danger"] as const).map((tone) => (
          <StatusPill key={tone} tone={tone} dot opaque={tone === "danger"}>
            {tone}
          </StatusPill>
        ))}
        <div className="rounded-card bg-brand-text p-2">
          <StatusPill tone="neutral" opaque dot>
            Opaque
          </StatusPill>
        </div>
      </Specimen>
      <Specimen name="Card, default and contained" bleed>
        <div className="flex flex-wrap gap-6">
          <Card className="w-72">
            <CardHeader>
              <CardTitle>Default card</CardTitle>
              <CardDescription>Cards compose headers and descriptions.</CardDescription>
              <CardAction>
                <IconButton label="More" noTooltip>
                  <MoreHorizontal aria-hidden />
                </IconButton>
              </CardAction>
            </CardHeader>
            <CardContent>Content area</CardContent>
            <CardFooter>
              <Button size="sm">Action</Button>
            </CardFooter>
          </Card>
          <Card
            variant="contained"
            className="w-72"
            thumbnail={<LessonThumb lesson={{ title: "Fractions", themeId: "chalk" }} />}
            overlay={
              <CardOverlay>
                <StatusPill opaque>Draft</StatusPill>
              </CardOverlay>
            }
            heading="Contained card"
            meta="Year 4 · 6 slides"
          />
        </div>
      </Specimen>
      <Specimen name="SectionHeading, count and action" bleed>
        <SectionHeading
          count={4}
          action={
            <Button size="sm" variant="ghost">
              See all
            </Button>
          }
        >
          Lessons
        </SectionHeading>
      </Specimen>
      <Specimen name="Stack, one two and three sheets" bleed>
        <div className="flex flex-wrap gap-12 pt-7">
          {[1, 2, 3].map((count) => (
            <Variant key={count} label={`${count} sheet${count === 1 ? "" : "s"}`}>
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
            title="No lessons"
            body="Create your first lesson."
            action={<Button>New lesson</Button>}
          />
          <EmptyState
            icon={<Plus />}
            iconTone="quiet"
            title="No results"
            body="Try another search."
          />
          <EmptyState stacked title="Nothing in this series" body="Add a lesson to get started." />
        </div>
      </Specimen>
      <Specimen name="PageTitle, renameable">
        <PageTitle label="Lesson title" renameLabel="Rename lesson" onCommit={setTitle}>
          {title}
        </PageTitle>
      </Specimen>
      <Specimen name="Display, all sizes" headingLevel={2}>
        {(["sm", "md", "lg", "xl"] as const).map((size) => (
          <Variant key={size} label={size}>
            <Display as="h3" size={size}>
              Teaching Journey
            </Display>
          </Variant>
        ))}
      </Specimen>
    </KitGroup>
  );
}
