import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GUARD_MESSAGE } from "@tj/domain/documents";
import { TooltipProvider } from "@tj/ui";
import type { ReactNode } from "react";
import { installFakeApi } from "@/test/fake-api";

const { fakeApi, restore: restoreFetch } = installFakeApi();

const navigate = mock();
const toastSpy = mock();
const actualRouter = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
  ...actualRouter,
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
  useNavigate: () => navigate,
}));
const actualUi = await import("@tj/ui");
mock.module("@tj/ui", () => ({ ...actualUi, toast: toastSpy }));

const { LessonBriefPage } = await import("./lesson-brief.page");

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <LessonBriefPage />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

const topicBox = () => screen.getByRole("textbox", { name: "Topic or objective" });
const createButton = () => screen.getByRole("button", { name: "Create lesson" });
const lastPost = () => fakeApi.requests.filter((r) => r.path === "/lessons").at(-1);

/** Radix Select opens on a real pointer sequence, so drive it with user-event. */
async function pickYearGroup(label: string): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: "Year group" }));
  await user.click(screen.getByRole("option", { name: label }));
}

describe("LessonBriefPage", () => {
  beforeEach(() => {
    navigate.mockReset();
    toastSpy.mockReset();
    cleanup();
    fakeApi.reset();
  });
  afterAll(() => {
    mock.restore();
    restoreFetch();
  });

  it("focuses the topic, disables Create until there is one, and defaults the duration by key stage", async () => {
    renderPage();
    expect(topicBox()).toHaveFocus();
    expect(createButton()).toBeDisabled();
    const duration = screen.getByRole("spinbutton", { name: "Duration (minutes)" });
    expect(duration).toHaveAttribute("placeholder", "60");

    fireEvent.change(topicBox(), { target: { value: "Fractions of amounts" } });
    expect(createButton()).toBeEnabled();
    // The two questions appear with their first option selected.
    expect(screen.getByRole("radio", { name: "Recall fractions of amounts" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "New to it" })).toBeChecked();

    await pickYearGroup("Year 1");
    await waitFor(() => expect(duration).toHaveAttribute("placeholder", "45"));
    await pickYearGroup("Reception");
    await waitFor(() => expect(duration).toHaveAttribute("placeholder", "30"));
  });

  it("posts the brief with the default answers and no durationMin, then opens the lesson", async () => {
    renderPage();
    fireEvent.change(topicBox(), { target: { value: "Fractions of amounts" } });
    await pickYearGroup("Year 5");
    fireEvent.click(createButton());

    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(lastPost()?.body).toEqual({
      brief: {
        topic: "Fractions of amounts",
        answers: {
          objectiveVerb: "Recall fractions of amounts",
          priorConfidence: "New to it",
        },
      },
      yearGroup: "Year 5",
      themeId: "chalk",
    });
    // The new row is the locked one: `POST /lessons` inserts it under its job's lock.
    const created = fakeApi.live("lesson").find((row) => row.generatingJobId !== null);
    expect(created?.body.title).toBe("Fractions of amounts");
    expect(navigate).toHaveBeenCalledWith({
      to: "/l/$lessonId",
      params: { lessonId: created?.id },
    });
  });

  it("skipping both questions sends no answers; a typed duration travels as durationMin", async () => {
    renderPage();
    fireEvent.change(topicBox(), { target: { value: "The water cycle" } });
    for (const skip of screen.getAllByRole("button", { name: "Skip" })) fireEvent.click(skip);
    expect(screen.getAllByText("Skipped — the plan decides.")).toHaveLength(2);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Duration (minutes)" }), {
      target: { value: "45" },
    });
    fireEvent.click(createButton());
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(lastPost()?.body).toEqual({
      brief: { topic: "The water cycle", durationMin: 45 },
      themeId: "chalk",
    });
  });

  it("the identifier guard blocks Create and marks the match; a Title Case topic passes", async () => {
    renderPage();
    fireEvent.change(topicBox(), { target: { value: "Year 6 Key Stage 2 Vikings" } });
    fireEvent.blur(topicBox());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(createButton()).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Add class context" }));
    const notes = screen.getByRole("textbox", { name: "Notes" });
    fireEvent.change(notes, { target: { value: "A pupil called Jamie struggles" } });
    fireEvent.blur(notes);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(GUARD_MESSAGE);
    expect(alert.querySelector("mark")).toHaveTextContent("pupil called");
    expect(notes).toHaveAttribute("aria-invalid", "true");
    expect(createButton()).toBeDisabled();

    fireEvent.change(notes, { target: { value: "Lively after lunch" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(createButton()).toBeEnabled();
  });

  it("class context travels as counts and text; an out-of-range duration explains itself", async () => {
    renderPage();
    fireEvent.change(topicBox(), { target: { value: "Rivers" } });
    fireEvent.click(screen.getByRole("button", { name: "Add class context" }));
    fireEvent.click(screen.getByRole("radio", { name: "25–30" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "SEND" }), { target: { value: "3" } });
    fireEvent.change(screen.getByRole("textbox", { name: "What the class already knows" }), {
      target: { value: "Named the parts of a river" },
    });
    const duration = screen.getByRole("spinbutton", { name: "Duration (minutes)" });
    fireEvent.change(duration, { target: { value: "2" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Between 5 and 180 minutes.");
    expect(createButton()).toBeDisabled();
    fireEvent.change(duration, { target: { value: "" } });

    fireEvent.click(createButton());
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(lastPost()?.body).toEqual({
      brief: {
        topic: "Rivers",
        classContext: {
          sizeBand: "25to30",
          needs: { send: 3 },
          priorKnowledge: "Named the parts of a river",
        },
      },
      themeId: "chalk",
    });
  });

  it("an API failure toasts the message, marks its fields and keeps the form", async () => {
    fakeApi.failNext(
      (r) => r.path === "/lessons",
      () =>
        new Response(
          JSON.stringify({
            error: {
              code: "validation_failed",
              message: "The request contains invalid fields.",
              fields: ["brief"],
            },
          }),
          { status: 400 },
        ),
    );
    renderPage();
    fireEvent.change(topicBox(), { target: { value: "Fractions of amounts" } });
    fireEvent.click(createButton());
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith("The request contains invalid fields."),
    );
    expect(navigate).not.toHaveBeenCalled();
    expect(topicBox()).toHaveValue("Fractions of amounts");
    expect(topicBox()).toHaveAttribute("aria-invalid", "true");
    // Editing clears the server's mark: it described the request that was sent.
    fireEvent.change(topicBox(), { target: { value: "Fractions of amounts and shapes" } });
    expect(topicBox()).not.toHaveAttribute("aria-invalid");

    fakeApi.failNext(
      (r) => r.path === "/lessons",
      () =>
        new Response(
          JSON.stringify({
            error: {
              code: "rate_limited",
              message: "Too many lessons at once — try again in a minute.",
            },
          }),
          { status: 429 },
        ),
    );
    fireEvent.click(createButton());
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith("Too many lessons at once — try again in a minute."),
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it("the upload tab is a disabled placeholder", () => {
    renderPage();
    const upload = screen.getByRole("tab", { name: /Upload — coming soon/ });
    expect(upload).toBeDisabled();
  });
});
