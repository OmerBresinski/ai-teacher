import { Link, useParams } from "@tanstack/react-router";
import { buttonVariants, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@tj/ui";
import { NotFoundPage } from "@/components/not-found-page";
import { type PreviewLesson, previewLesson } from "./preview-lesson";

/**
 * An existing account signed in from a signed-out lesson (ruling 112): the lesson stays with the
 * preview, so `/l/<id>` 404s for them. Offer the brief again with the same topic.
 */
export function ClaimDeclined({ preview }: { preview: PreviewLesson }) {
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center p-6">
      <Card>
        <CardHeader>
          <CardTitle>This lesson stayed in the preview</CardTitle>
          <CardDescription>
            You signed in to an account you already had, so the lesson you made before signing in
            stays in the preview. Make it again in your account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            to="/lessons/new"
            search={{ topic: preview.topic }}
            className={buttonVariants({ variant: "primary" })}
          >
            Make “{preview.topic}” again
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}

/**
 * `/l/$lessonId` not found. When this browser asked to sign in from that very lesson, the lesson
 * was not claimed (ruling 112), so say so; otherwise the usual not-found page.
 */
export function LessonNotFoundPage() {
  const { lessonId } = useParams({ strict: false });
  const preview = lessonId ? previewLesson(lessonId) : null;
  return preview ? <ClaimDeclined preview={preview} /> : <NotFoundPage />;
}
