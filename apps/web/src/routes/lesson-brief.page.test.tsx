import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Lesson } from "@tj/domain/documents";
import { generatedLesson, lessonFacts } from "@tj/domain/documents/fixtures";
import { TooltipProvider } from "@tj/ui";
import type { ReactNode } from "react";
import { readLastClass } from "@/lib/brief-memory";
import { installFakeApi } from "@/test/fake-api";
import { installFakeEventSource } from "@/test/fake-event-source";

const { fakeApi, restore } = installFakeApi();
const originalEventSource = globalThis.EventSource;
const navigate = mock();
let search: { topic?: string; source?: "1"; lesson?: string } = {};
const actualRouter = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
  ...actualRouter,
  Link: ({ children }: { children: ReactNode }) => <a href="/lessons">{children}</a>,
  useNavigate: () => navigate,
  useSearch: () => search,
}));
mock.module("@/components/lesson-creation/character-host", () => ({ CharacterHost: () => null }));
const { LessonBriefPage } = await import("./lesson-brief.page");
function show() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <LessonBriefPage />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}
const post = () =>
  fakeApi.requests.filter((r) => r.path === "/lessons").at(-1)?.body as {
    brief: Record<string, unknown>;
    requestId: string;
    skipPlanning: boolean;
    yearGroup: string;
    themeId?: string;
  };
/** A lesson at `planned`, as the plan job leaves it, drawn in `themeId`; the page opens on it. */
function openPlanned(themeId = "chalk") {
  const { artefacts: _artefacts, ...lesson } = generatedLesson();
  const generation = lesson.generation;
  if (!generation) throw new Error("fixture without generation");
  const row = fakeApi.insertLesson({
    ...lesson,
    themeId,
    yearGroup: "Year 5",
    brief: { topic: "The water cycle", durationMin: 60, slideCount: 8 },
    facts: lessonFacts(),
    generation: { ...generation, stage: "planned" },
    plan: { revision: 1, state: "proposed", jobId: crypto.randomUUID() },
  } as Lesson);
  // The page listens to the plan job over SSE until the plan is on screen.
  installFakeEventSource();
  search = { lesson: row.id };
  show();
  return row.id;
}
const themeRadios = async () => {
  const group = await screen.findByRole("radiogroup", { name: "Theme" });
  return Array.from(group.querySelectorAll<HTMLInputElement>("input[type=radio]"));
};
describe("real lesson intake", () => {
  beforeEach(() => {
    cleanup();
    fakeApi.reset();
    fakeApi.requests.length = 0;
    navigate.mockReset();
    localStorage.clear();
    search = {};
  });
  afterAll(() => {
    cleanup();
    restore();
    globalThis.EventSource = originalEventSource;
    mock.restore();
  });
  it("preserves homepage topic and creates an idempotent proposed plan without minutes", async () => {
    search = { topic: "The water cycle" };
    show();
    expect(screen.getByRole("textbox", { name: "Topic" })).toHaveValue("The water cycle");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(post().skipPlanning).toBe(false);
    expect(post().brief).toEqual({ topic: "The water cycle", level: "standard", slideCount: 8 });
    expect(post().requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(navigate.mock.calls[0]?.[0]).toMatchObject({
      to: "/lessons/new",
      search: { lesson: expect.any(String) },
    });
  });
  it("reuses the exact request id and payload after an uncertain create response", async () => {
    search = { topic: "Rocks" };
    const transport = globalThis.fetch;
    const sent: unknown[] = [];
    let first = true;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/lessons") && init?.method === "POST") {
        sent.push(JSON.parse(String(init.body)));
        if (first) {
          first = false;
          throw new TypeError("Connection lost");
        }
      }
      return transport(input, init);
    }) as typeof fetch;
    try {
      show();
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
      await screen.findByRole("alert");
      await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).toBeEnabled());
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
      await waitFor(() => expect(navigate).toHaveBeenCalled());
      expect(sent).toHaveLength(2);
      expect(sent[0]).toEqual(sent[1]);
    } finally {
      globalThis.fetch = transport;
    }
  });

  it("skip planning opens the real editor through the one-job path", async () => {
    search = { topic: "Rocks" };
    show();
    fireEvent.click(screen.getByRole("button", { name: "Skip planning" }));
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(post().skipPlanning).toBe(true);
    expect(navigate.mock.calls[0]?.[0]).toMatchObject({ to: "/l/$lessonId" });
  });
  it("preserves blank lesson and source controls including pasted text", () => {
    search = { source: "1" };
    show();
    expect(screen.getByRole("dialog", { name: "Add your materials" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Paste text" })).toBeTruthy();
    expect(screen.getByLabelText("Choose files", { selector: "input" })).toHaveAttribute(
      "accept",
      ".pdf,.pptx,.docx",
    );
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByRole("button", { name: "Blank lesson" })).toBeTruthy();
  });
  it("remembers the class without skipping decisions", async () => {
    localStorage.setItem(
      "tj:brief:last-class",
      JSON.stringify({
        yearGroup: "Year 6",
        subject: "Science",
        subjectOther: "",
        themeId: "chalk",
      }),
    );
    search = { topic: "Light" };
    show();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(post().yearGroup).toBe("Year 6");
    expect(post().skipPlanning).toBe(false);
  });

  it("offers six theme tiles on the objectives step with the default chosen (ruling 113)", async () => {
    openPlanned();
    const radios = await themeRadios();
    expect(radios).toHaveLength(6);
    expect(radios.filter((r) => r.checked).map((r) => r.value)).toEqual(["chalk"]);
  });
  it("preselects the remembered theme over the lesson's own", async () => {
    localStorage.setItem(
      "tj:brief:last-class",
      JSON.stringify({ yearGroup: "Year 5", subject: "", subjectOther: "", themeId: "night-lab" }),
    );
    openPlanned("chalk");
    const radios = await themeRadios();
    expect(radios.find((r) => r.checked)?.value).toBe("night-lab");
  });
  it("confirms with the picked theme and remembers it for the next brief", async () => {
    const id = openPlanned();
    const radios = await themeRadios();
    const beacon = radios.find((r) => r.value === "beacon");
    if (!beacon) throw new Error("no beacon tile");
    fireEvent.click(beacon);
    expect(beacon.checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Just the slides" }));
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    const confirm = fakeApi.requests.find((r) => r.path === `/lessons/${id}/generate`);
    expect(confirm?.body).toMatchObject({ expectedRevision: 1, themeId: "beacon" });
    expect(readLastClass()).toMatchObject({ yearGroup: "Year 5", themeId: "beacon" });
  });
  it("skip planning sends the remembered theme and writes it back", async () => {
    localStorage.setItem(
      "tj:brief:last-class",
      JSON.stringify({ yearGroup: "Year 6", subject: "", subjectOther: "", themeId: "playground" }),
    );
    search = { topic: "Rocks" };
    show();
    fireEvent.click(screen.getByRole("button", { name: "Skip planning" }));
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(post().themeId).toBe("playground");
    expect(readLastClass()?.themeId).toBe("playground");
  });
  it("a brief with nothing remembered creates the lesson in the default theme", async () => {
    search = { topic: "Rocks" };
    show();
    fireEvent.click(screen.getByRole("button", { name: "Skip planning" }));
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(post().themeId).toBe("chalk");
    expect(readLastClass()?.themeId).toBe("chalk");
  });
});
