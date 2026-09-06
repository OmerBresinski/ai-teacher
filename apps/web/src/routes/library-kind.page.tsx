import { LibraryPage } from "@/components/library-page";

export function LessonsPage() {
  return <LibraryPage mode="lesson" />;
}

export function WorksheetsPage() {
  return <LibraryPage mode="worksheet" />;
}

export function SeriesPage() {
  return <LibraryPage mode="series" />;
}
