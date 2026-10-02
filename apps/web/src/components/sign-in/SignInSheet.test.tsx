import { beforeEach, describe, expect, it, mock } from "bun:test";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

const magicLink = mock();
const social = mock();
mock.module("@/lib/auth", () => ({ authClient: { signIn: { magicLink, social } } }));

let params: { lessonId?: string } = {};
const actualRouter = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
  ...actualRouter,
  Link: ({ children, to, search }: { children: ReactNode; to: string; search?: object }) => (
    <a href={`${to}?${new URLSearchParams(search as Record<string, string>)}`}>{children}</a>
  ),
  useParams: () => params,
}));

const { SIGN_IN_SHEET_SENT_NOTE, SIGN_IN_TO_EDIT, SignInSheet } = await import("./SignInSheet");
const { LessonNotFoundPage } = await import("./claim-declined");
const { previewLesson, rememberPreviewLesson, PREVIEW_LESSON_KEY } = await import(
  "./preview-lesson"
);

describe("SignInSheet (TEACH-245)", () => {
  beforeEach(() => {
    magicLink.mockReset();
    social.mockReset();
  });

  it("row 3: opens as a dialog with Google and email; Google returns to the lesson", async () => {
    social.mockResolvedValue({ data: null, error: null });
    const user = userEvent.setup();
    render(<SignInSheet open onOpenChange={() => {}} redirect="/l/lesson-1" />);
    const sheet = screen.getByRole("dialog", { name: SIGN_IN_TO_EDIT });

    await user.click(within(sheet).getByRole("button", { name: "Continue with Google" }));
    expect(social).toHaveBeenCalledWith({
      provider: "google",
      callbackURL: `${window.location.origin}/l/lesson-1`,
      errorCallbackURL: `${window.location.origin}/sign-in?redirect=%2Fl%2Flesson-1`,
    });
  });

  it("the magic link returns to the lesson and the sent state says where to open it", async () => {
    magicLink.mockResolvedValue({ data: { status: true }, error: null });
    const user = userEvent.setup();
    render(<SignInSheet open onOpenChange={() => {}} redirect="/l/lesson-1" />);
    const sheet = screen.getByRole("dialog", { name: SIGN_IN_TO_EDIT });
    await user.type(within(sheet).getByLabelText("Email address"), "Ada@Example.com");
    await user.click(within(sheet).getByRole("button", { name: "Email me a link" }));
    expect(magicLink).toHaveBeenCalledWith({
      email: "ada@example.com",
      callbackURL: `${window.location.origin}/l/lesson-1`,
      errorCallbackURL: `${window.location.origin}/sign-in?redirect=%2Fl%2Flesson-1`,
    });
    const status = await within(sheet).findByRole("status");
    expect(status).toHaveTextContent("Check your inbox");
    expect(status).toHaveTextContent(SIGN_IN_SHEET_SENT_NOTE);
  });

  it("the sheet's email link carries a Turnstile token, like /sign-in (TEACH-243)", async () => {
    const { env } = await import("@/env");
    const before = env.VITE_TURNSTILE_SITE_KEY;
    env.VITE_TURNSTILE_SITE_KEY = "1x00000000000000000000AA";
    window.turnstile = {
      render: (_el, options) => {
        queueMicrotask(() => options.callback?.("sheet-token"));
        return "w1";
      },
      reset: mock(),
      remove: mock(),
      getResponse: mock(),
    };
    try {
      magicLink.mockResolvedValue({ data: { status: true }, error: null });
      const user = userEvent.setup();
      render(<SignInSheet open onOpenChange={() => {}} redirect="/l/lesson-1" />);
      const sheet = screen.getByRole("dialog", { name: SIGN_IN_TO_EDIT });
      await user.type(within(sheet).getByLabelText("Email address"), "ada@example.com");
      await user.click(within(sheet).getByRole("button", { name: "Email me a link" }));
      expect(magicLink).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "ada@example.com",
          fetchOptions: { headers: { "x-captcha-response": "sheet-token" } },
        }),
      );
    } finally {
      env.VITE_TURNSTILE_SITE_KEY = before;
      delete window.turnstile;
    }
  });

  it("closed, it renders nothing", () => {
    render(<SignInSheet open={false} onOpenChange={() => {}} redirect="/l/lesson-1" />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("preview lesson and the declined claim (ruling 112)", () => {
  beforeEach(() => localStorage.clear());

  it("remembers the lesson for a day, for that lesson only", () => {
    rememberPreviewLesson("lesson-1", "Volcanoes", 1_000);
    expect(previewLesson("lesson-1", 2_000)).toEqual({
      lessonId: "lesson-1",
      topic: "Volcanoes",
      at: 1_000,
    });
    expect(previewLesson("lesson-2", 2_000)).toBeNull();
    expect(previewLesson("lesson-1", 1_000 + 25 * 60 * 60 * 1000)).toBeNull();
    localStorage.setItem(PREVIEW_LESSON_KEY, "{not json");
    expect(previewLesson("lesson-1")).toBeNull();
  });

  it("row 6: a 404 for the lesson this browser signed in from says it stayed in the preview", () => {
    rememberPreviewLesson("lesson-1", "Volcanoes");
    params = { lessonId: "lesson-1" };
    render(<LessonNotFoundPage />);
    expect(screen.getByText("This lesson stayed in the preview")).toBeVisible();
    expect(screen.getByRole("link", { name: "Make “Volcanoes” again" })).toHaveAttribute(
      "href",
      "/lessons/new?topic=Volcanoes",
    );
  });

  it("any other 404 is the usual not-found page", () => {
    params = { lessonId: "lesson-9" };
    render(<LessonNotFoundPage />);
    expect(screen.getByText("Page not found")).toBeVisible();
  });
});
