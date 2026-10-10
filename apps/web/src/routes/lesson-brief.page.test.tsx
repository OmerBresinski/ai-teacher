import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { GUARD_MESSAGE, type Lesson, lessonFromBrief } from "@tj/domain/documents";
import { generatedLesson, lessonFacts } from "@tj/domain/documents/fixtures";
import { TooltipProvider } from "@tj/ui";
import type { ReactNode } from "react";
import { readLastClass } from "@/lib/brief-memory";
import { installFakeApi } from "@/test/fake-api";
import { FakeEventSource, installFakeEventSource } from "@/test/fake-event-source";

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
// Turnstile is TEACH-243's widget; here only its token matters (always-pass test key semantics).
const turnstile = {
  getToken: mock(async (): Promise<string | null> => "turnstile-token"),
  reset: mock(),
  error: null,
  containerRef: () => {},
};
// sign-in.page.test.tsx mocks `@/lib/auth` for the whole run; the real better-auth client pointed
// at the fake api keeps `signIn.anonymous` honest here whatever order the files run in.
const { createAuthClient } = await import("@tj/api-client");
mock.module("@/lib/auth", () => ({
  authClient: createAuthClient(`${window.location.origin}/api`),
}));
// bun applies a module mock to the whole run, so keep every real export and hand back the stub
// only while this file runs; afterwards the real hook answers (use-turnstile-token.test.tsx).
// Copied before mocking: the mock rewrites the module's live exports in place.
const realTurnstile = { ...(await import("@/components/turnstile")) };
let stubTurnstile = true;
mock.module("@/components/turnstile", () => ({
  ...realTurnstile,
  useTurnstileToken: (...args: Parameters<typeof realTurnstile.useTurnstileToken>) => {
    // Always call the real hook (no site key in tests, so it stays off): same hooks every render.
    const real = realTurnstile.useTurnstileToken(...args);
    return stubTurnstile ? turnstile : real;
  },
}));
const { LessonBriefPage, REVEAL_MAX_MS } = await import("./lesson-brief.page");
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
describe("real lesson intake", () => {
  beforeEach(() => {
    cleanup();
    fakeApi.reset();
    fakeApi.requests.length = 0;
    navigate.mockReset();
    localStorage.clear();
    search = {};
    turnstile.getToken.mockReset();
    turnstile.getToken.mockImplementation(async () => "turnstile-token");
    turnstile.reset.mockReset();
  });
  afterAll(() => {
    stubTurnstile = false;
    cleanup();
    restore();
    globalThis.EventSource = originalEventSource;
    mock.restore();
  });
  it("opens on the brief with its heading focused and nothing filled in", async () => {
    show();
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Let’s start with your idea." })).toHaveFocus(),
    );
    expect(screen.getByRole("textbox", { name: "Topic" })).toHaveValue("");
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Skip planning" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Year group" })).toHaveTextContent("Year 4");
    expect(screen.getByRole("button", { name: "Blank lesson" })).toBeVisible();
  });
  it("preserves homepage topic and creates an idempotent proposed plan without minutes", async () => {
    search = { topic: "The water cycle" };
    show();
    expect(screen.getByRole("textbox", { name: "Topic" })).toHaveValue("The water cycle");
    // A prefilled topic never submits on its own (TEACH-309): nothing is posted before Next, even
    // after the async work an auto-submit would start has had time to run.
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(fakeApi.requests.filter((r) => r.path === "/lessons")).toHaveLength(0);
    expect(navigate).not.toHaveBeenCalled();
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

  it("the guard blocks a pupil reference: a status message and no POST on Next", async () => {
    show();
    const topic = screen.getByRole("textbox", { name: "Topic" });
    fireEvent.change(topic, {
      target: { value: "A pupil called Jamie struggles with the water cycle" },
    });
    expect(await screen.findByRole("status")).toHaveTextContent(GUARD_MESSAGE);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    // The submit is async (an anonymous session first), so prove the guarded click sent nothing by
    // what follows: a clean topic and Next post exactly once, with the clean topic.
    fireEvent.change(topic, { target: { value: "The water cycle" } });
    await waitFor(() => expect(screen.queryByText(GUARD_MESSAGE)).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    const posts = fakeApi.requests.filter((r) => r.path === "/lessons" && r.method === "POST");
    expect(posts).toHaveLength(1);
    expect(post().brief.topic).toBe("The water cycle");
  });

  it("skip planning opens the real editor through the one-job path", async () => {
    search = { topic: "Rocks" };
    show();
    fireEvent.click(screen.getByRole("button", { name: "Skip planning" }));
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(post().skipPlanning).toBe(true);
    expect(navigate.mock.calls[0]?.[0]).toMatchObject({ to: "/l/$lessonId" });
  });
  it("preserves blank lesson and source controls including pasted text", async () => {
    search = { source: "1" };
    show();
    expect(screen.getByRole("dialog", { name: "Add your materials" })).toBeTruthy();
    // `?source=1` opens on Choose files (TEACH-309); the file input shares its name, so take the
    // real <button>.
    const chooseFiles = screen
      .getAllByRole("button", { name: "Choose files" })
      .find((element) => element.tagName === "BUTTON");
    await waitFor(() => expect(chooseFiles).toHaveFocus());
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

  it("moves on to the objectives when Plan never hands over (its chunk failed after a deploy)", async () => {
    const { artefacts: _artefacts, ...lesson } = generatedLesson();
    const generation = lesson.generation;
    if (!generation) throw new Error("fixture without generation");
    const jobId = crypto.randomUUID();
    const row = fakeApi.insertLesson(
      {
        ...lesson,
        yearGroup: "Year 5",
        brief: { topic: "The water cycle", slideCount: 8 },
        facts: lessonFacts(),
        generation: { ...generation, stage: "planned" },
        plan: { revision: 1, state: "proposed", jobId },
      } as Lesson,
      jobId,
    );
    installFakeEventSource();
    search = { lesson: row.id };
    show();
    await screen.findByRole("heading", { name: "Planning your lesson" });
    await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0));
    // The job ends: the lock is released and the stream says so. CharacterHost is mocked to
    // nothing here, so Plan's hand-over (`onDone`) never comes, exactly as when its chunk 404s.
    row.generatingJobId = null;
    FakeEventSource.latest.open();
    FakeEventSource.latest.emit(
      "completed",
      { type: "completed", jobId, workspaceId: crypto.randomUUID(), at: new Date().toISOString() },
      "1",
    );
    await screen.findByText(/learning objectives are ready/);
    await screen.findByRole(
      "heading",
      { name: "Learning objectives" },
      { timeout: REVEAL_MAX_MS + 2000 },
    );
  }, 15_000);

  it("asks no theme question on the objectives step (ruling 116)", async () => {
    openPlanned();
    await screen.findByRole("button", { name: /Continue/ });
    expect(screen.queryByRole("radiogroup", { name: "Theme" })).toBeNull();
  });
  it("confirms with the remembered theme over the lesson's own", async () => {
    localStorage.setItem(
      "tj:brief:last-class",
      JSON.stringify({ yearGroup: "Year 5", subject: "", subjectOther: "", themeId: "night-lab" }),
    );
    const id = openPlanned("chalk");
    fireEvent.click(await screen.findByRole("button", { name: /Continue/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Just the slides" }));
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    const confirm = fakeApi.requests.find((r) => r.path === `/lessons/${id}/generate`);
    expect(confirm?.body).toMatchObject({ expectedRevision: 1, themeId: "night-lab" });
  });
  it("confirms with the class default when nothing is remembered, and does not remember it", async () => {
    const id = openPlanned("chalk");
    fireEvent.click(await screen.findByRole("button", { name: /Continue/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Just the slides" }));
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    const confirm = fakeApi.requests.find((r) => r.path === `/lessons/${id}/generate`);
    // Year 5 is Key Stage 2: Chalk & Cream.
    expect(confirm?.body).toMatchObject({ themeId: "chalk" });
    expect(readLastClass()?.themeId ?? "").toBe("");
  });
  it("skip planning sends the remembered theme and keeps it", async () => {
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
  it("a brief with nothing remembered creates the lesson in its class default", async () => {
    search = { topic: "Rocks" };
    show();
    fireEvent.click(screen.getByRole("button", { name: "Skip planning" }));
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    // The brief opens on Year 4: Playground.
    expect(post().themeId).toBe("playground");
    expect(readLastClass()?.themeId).toBe("");
  });
  it("signed out: Turnstile, anonymous sign-in with the token, then one create with a requestId", async () => {
    fakeApi.session = null;
    search = { topic: "Volcanoes" };
    show();
    expect(screen.getByRole("textbox", { name: "Topic" })).toHaveValue("Volcanoes");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    const writes = fakeApi.requests.filter((r) => r.method === "POST");
    expect(writes.map((r) => r.path)).toEqual(["/auth/sign-in/anonymous", "/lessons"]);
    expect(writes[0]?.headers.get("x-captcha-response")).toBe("turnstile-token");
    expect(post().requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(post().skipPlanning).toBe(false);
    // SO-1: the objectives step comes next, as for a teacher.
    expect(navigate.mock.calls[0]?.[0]).toMatchObject({
      to: "/lessons/new",
      search: { lesson: expect.any(String) },
    });
    expect(turnstile.reset).toHaveBeenCalled();
  });

  it("signed out: a dropped create response retries with the same request id and no second sign-in", async () => {
    fakeApi.session = null;
    search = { topic: "Rocks" };
    const transport = globalThis.fetch;
    const sent: unknown[] = [];
    let first = true;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith("/lessons") && (init?.method ?? (input as Request).method) === "POST") {
        sent.push(JSON.parse(String(init?.body)));
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
      expect(fakeApi.requests.filter((r) => r.path === "/auth/sign-in/anonymous")).toHaveLength(1);
      expect(fakeApi.live("lesson").filter((r) => r.body.title === "Rocks")).toHaveLength(1);
    } finally {
      globalThis.fetch = transport;
    }
  });

  it("anonymous at the lesson limit is asked to sign in, and the brief stays", async () => {
    fakeApi.session = "anonymous";
    fakeApi.failNext(
      (r) => r.method === "POST" && r.path === "/lessons",
      () =>
        Response.json(
          { error: { code: "anonymous_limit", message: "x", requestId: "r", retryable: false } },
          { status: 403 },
        ),
    );
    search = { topic: "Volcanoes" };
    show();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    // The sign-in sheet (TEACH-245) opens over the brief; the brief stays behind it.
    const sheet = await screen.findByRole("dialog", { name: "Sign in to make more lessons" });
    expect(within(sheet).getByRole("button", { name: "Continue with Google" })).toBeTruthy();
    expect(within(sheet).getByLabelText("Email address")).toBeTruthy();
    expect(fakeApi.requests.some((r) => r.path === "/auth/sign-in/anonymous")).toBe(false);
    expect(screen.getByRole("textbox", { name: "Topic", hidden: true })).toHaveValue("Volcanoes");
    expect(navigate).not.toHaveBeenCalled();
    fireEvent.keyDown(sheet, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("textbox", { name: "Topic" })).toHaveValue("Volcanoes");
  });

  it("the daily cap (0 closes it) degrades to today's sign-in flow with the topic kept", async () => {
    fakeApi.session = null;
    fakeApi.anonymousCapacity = true;
    search = { topic: "Volcanoes" };
    show();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: "/sign-in",
        search: { redirect: "/lessons/new?topic=Volcanoes" },
      }),
    );
    expect(fakeApi.requests.some((r) => r.path === "/lessons")).toBe(false);
  });

  it("a failed Turnstile check shows an inline retry and signs nobody in", async () => {
    fakeApi.session = null;
    turnstile.getToken.mockImplementationOnce(async () => {
      throw new Error("We couldn’t check this browser. Try again.");
    });
    search = { topic: "Volcanoes" };
    show();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect((await screen.findByRole("alert")).textContent).toContain("check this browser");
    expect(fakeApi.requests.some((r) => r.method === "POST")).toBe(false);
    await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(fakeApi.requests.filter((r) => r.path === "/auth/sign-in/anonymous")).toHaveLength(1);
  });

  it("signed out: no drop zone or blank lesson; Add materials signs in first (ruling 110)", async () => {
    fakeApi.session = null;
    search = { topic: "Volcanoes" };
    show();
    const add = await screen.findByRole("button", { name: "Add materials" });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Blank lesson" })).toBeNull());
    fireEvent.click(add);
    expect(screen.queryByRole("dialog", { name: "Add your materials" })).toBeNull();
    expect(navigate).toHaveBeenCalledWith({
      to: "/sign-in",
      search: { redirect: "/lessons/new?topic=Volcanoes&source=1" },
    });
  });

  it("a signed-in teacher never signs in anonymously and still sends a requestId", async () => {
    search = { topic: "Rocks" };
    show();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(fakeApi.requests.some((r) => r.path.startsWith("/auth"))).toBe(false);
    expect(turnstile.getToken).not.toHaveBeenCalled();
    expect(post().requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  describe("anonymous objectives step (SO-1)", () => {
    function seedPlanned() {
      const lesson = lessonFromBrief(
        { brief: { topic: "Volcanoes", level: "standard" }, yearGroup: "Year 4" },
        "planned-volcanoes",
        new Date(),
      ) as Lesson;
      lesson.generation = { ...lesson.generation, stage: "planned" } as Lesson["generation"];
      lesson.facts = {
        objectives: [{ id: "o1", text: "Explain how a volcano erupts" }],
      } as unknown as Lesson["facts"];
      lesson.plan = { state: "proposed", revision: 1 } as Lesson["plan"];
      fakeApi.rows.set(lesson.id, {
        id: lesson.id,
        kind: "lesson",
        body: lesson,
        createdAt: lesson.createdAt,
        updatedAt: lesson.updatedAt,
        deletedAt: null,
        generatingJobId: null,
      });
      return lesson.id;
    }

    it("Continue generates straight away: no worksheet step", async () => {
      fakeApi.session = "anonymous";
      const id = seedPlanned();
      search = { lesson: id };
      show();
      fireEvent.click(await screen.findByRole("button", { name: /Continue/ }));
      await waitFor(() =>
        expect(navigate).toHaveBeenCalledWith({ to: "/l/$lessonId", params: { lessonId: id } }),
      );
      expect(fakeApi.requests.some((r) => r.path === `/lessons/${id}/generate`)).toBe(true);
      expect(screen.queryByText("Add a worksheet?")).toBeNull();
    });

    it("a refused re-plan or confirm asks to sign in and keeps the plan on screen", async () => {
      fakeApi.session = "anonymous";
      const id = seedPlanned();
      fakeApi.failNext(
        (r) => r.path === `/lessons/${id}/generate`,
        () =>
          Response.json(
            {
              error: {
                code: "sign_in_required",
                message: "Sign in to keep changing the plan.",
                requestId: "r",
                retryable: false,
              },
            },
            { status: 403 },
          ),
      );
      search = { lesson: id };
      show();
      fireEvent.click(await screen.findByRole("button", { name: /Continue/ }));
      expect(
        await screen.findByRole("dialog", { name: "Sign in to keep changing the plan" }),
      ).toBeTruthy();
      expect(screen.getByDisplayValue("Explain how a volcano erupts")).toBeTruthy();
      expect(navigate).not.toHaveBeenCalled();
    });
  });
});
