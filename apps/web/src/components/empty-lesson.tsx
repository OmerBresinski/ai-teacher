import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Lesson } from "@tj/domain/documents";
import { Button, EmptyState, IconButton, toast } from "@tj/ui";
import { ArrowLeft, Presentation } from "lucide-react";
import { libraryMutations } from "@/lib/library";
import { queryKeys } from "@/lib/query";

const ICON = <Presentation strokeWidth={1.5} />;

/**
 * `/l/$lessonId` for a lesson with no slides and no generating lock: a brief whose `lesson.plan`
 * job was cancelled or failed before it wrote a slide (ADR 0024 §6, §18). The editor needs an
 * active slide to draw, so this offers the first one — a title slide in the lesson's theme, saved
 * through the normal write path — and the editor takes over once the query refetches.
 */
export function EmptyLesson({ lesson, onBack }: { lesson: Lesson; onBack: () => void }) {
  const queryClient = useQueryClient();
  const { mutate: save, isPending } = useMutation({
    ...libraryMutations.saveDocument(queryClient),
    // The whole family, this document's working copy included: the editor mounts from the refetch.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.library }),
    onError: (error) => toast(error.message),
  });

  async function addSlide(): Promise<void> {
    const { newSlide } = await import("@tj/editor/starter");
    save({ ...lesson, slides: [newSlide("title", lesson.themeId)] });
  }

  return (
    <div className="min-h-dvh">
      <header className="flex items-center gap-3 px-6 py-3">
        <IconButton label="Back to the library" onClick={onBack}>
          <ArrowLeft aria-hidden size={16} strokeWidth={1.5} />
        </IconButton>
        <h1 className="truncate text-lead font-semibold">{lesson.title}</h1>
      </header>
      <main className="flex items-center justify-center px-6 py-12">
        <EmptyState
          icon={ICON}
          title="This lesson has no slides yet"
          body="Generation did not finish. Start the deck yourself with a title slide."
          action={
            <Button onClick={() => void addSlide()} disabled={isPending}>
              Add a title slide
            </Button>
          }
        />
      </main>
    </div>
  );
}
