import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TooltipProvider } from "@tj/ui";
import type { ReactNode } from "react";
import { installFakeApi } from "@/test/fake-api";

const { fakeApi, restore } = installFakeApi();
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
});
