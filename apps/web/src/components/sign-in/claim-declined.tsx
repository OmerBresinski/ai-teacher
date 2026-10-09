import { Link, useParams } from "@tanstack/react-router";
import { buttonVariants, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@tj/ui";
import { NotFoundPage } from "@/components/not-found-page";
import { type PreviewLesson, previewLesson } from "./preview-lesson";

/**
 * A signed-out lesson that could not be moved into the account that signed in (ruling 127: shown
 * only when the move fails), so `/l/<id>` 404s for them. Offer the brief again with the topic.
 */
export function ClaimDeclined({ preview }: { preview: PreviewLesson }) {
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center p-6">
      <Card>
        <CardHeader>
          <CardTitle>We couldn't move this lesson</CardTitle>
          <CardDescription>
            The lesson you made before signing in could not be added to your account. Make it again
            and it will be saved there.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            to="/lessons/new"
            search={{ topic: preview.topic }}
            className={buttonVariants({ variant: "primary" })}
          >
            {preview.topic ? `Make “${preview.topic}” again` : "Make it again"}
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}

/**
 * `/l/$lessonId` not found. When this browser asked to sign in from that very lesson, the move
 * failed (ruling 127), so say so; otherwise the usual not-found page.
 */
export function LessonNotFoundPage() {
  const { lessonId } = useParams({ strict: false });
  const preview = lessonId ? previewLesson(lessonId) : null;
  return preview ? <ClaimDeclined preview={preview} /> : <NotFoundPage />;
}
