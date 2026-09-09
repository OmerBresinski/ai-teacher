import { describe, expect, test } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import type { JobEvent } from "@tj/domain/jobs";
import { TAKING_LONGER_TEXT } from "@/lib/generation-estimate";
import {
  ESTIMATE_HISTORY_FIXTURE as HISTORY,
  RUN_STEPS,
  runEvents,
  THIN_HISTORY_FIXTURE,
} from "@/lib/generation-estimate.fixture";
import { EstimateText } from "./estimate-text";

const T0 = Date.parse("2026-09-09T10:00:00.000Z");
const upTo = (count: number) => runEvents(T0, RUN_STEPS.slice(0, count), 1_000);
const landedAt = (count: number) => T0 + count * 1_000;
const SLIDE_6 = 9;

/** A clock the test moves by hand; the same function identity across rerenders, like `Date.now`. */
function fakeClock(start: number) {
  let now = start;
  return {
    clock: () => now,
    set: (ms: number) => {
      now = ms;
    },
  };
}

describe("EstimateText", () => {
  test("mounts at Planning with the fixture and says the range (acceptance 1)", () => {
    const { clock } = fakeClock(T0);
    render(<EstimateText history={HISTORY} events={upTo(2)} slides={8} clock={clock} />);
    const estimate = screen.getByTestId("generation-estimate");
    expect(estimate).toHaveTextContent("About 2 to 3 minutes left");
    expect(estimate.dataset.state).toBe("range");
  });

  test("renders nothing with thin or missing history (acceptance 4)", () => {
    const { clock } = fakeClock(T0);
    const thin = render(
      <EstimateText history={THIN_HISTORY_FIXTURE} events={upTo(2)} slides={8} clock={clock} />,
    );
    expect(thin.container).toBeEmptyDOMElement();
    const none = render(<EstimateText history={null} events={upTo(2)} slides={8} clock={clock} />);
    expect(none.container).toBeEmptyDOMElement();
  });

  test("between events the text does not change, however long it has been (acceptance 6)", () => {
    const { clock, set } = fakeClock(T0);
    const view = render(
      <EstimateText history={HISTORY} events={upTo(2)} slides={8} clock={clock} />,
    );
    expect(screen.getByTestId("generation-estimate")).toHaveTextContent(
      "About 2 to 3 minutes left",
    );
    // Forty seconds on with no event: a fresh reading would say "About 1 to 3"; nothing ticks.
    set(T0 + 40_000);
    view.rerender(<EstimateText history={HISTORY} events={upTo(2)} slides={8} clock={clock} />);
    expect(screen.getByTestId("generation-estimate")).toHaveTextContent(
      "About 2 to 3 minutes left",
    );
  });

  test("narrows as slides land and goes quiet under 20 seconds (acceptance 2, 5)", () => {
    const { clock, set } = fakeClock(T0);
    const view = render(
      <EstimateText history={HISTORY} events={upTo(2)} slides={8} clock={clock} />,
    );
    set(landedAt(SLIDE_6));
    view.rerender(
      <EstimateText history={HISTORY} events={upTo(SLIDE_6)} slides={8} clock={clock} />,
    );
    expect(screen.getByTestId("generation-estimate")).toHaveTextContent("Less than 2 minutes left");
    set(landedAt(14));
    view.rerender(<EstimateText history={HISTORY} events={upTo(14)} slides={8} clock={clock} />);
    expect(screen.getByTestId("generation-estimate")).toHaveTextContent("Less than a minute left");
    set(landedAt(15));
    view.rerender(<EstimateText history={HISTORY} events={upTo(15)} slides={8} clock={clock} />);
    expect(view.container).toBeEmptyDOMElement();
  });

  test("moves up when the outline's slide count replaces the brief's, then narrows on it", () => {
    // Three slides in the brief, eight in the outline: the honest reading rises at "Slide 1 of 8".
    const { clock, set } = fakeClock(landedAt(3));
    const view = render(
      <EstimateText history={HISTORY} events={upTo(3)} slides={3} clock={clock} />,
    );
    expect(screen.getByTestId("generation-estimate")).toHaveTextContent(
      "About 1 to 2 minutes left",
    );
    set(landedAt(4));
    view.rerender(<EstimateText history={HISTORY} events={upTo(4)} slides={3} clock={clock} />);
    expect(screen.getByTestId("generation-estimate")).toHaveTextContent(
      "About 1 to 3 minutes left",
    );
    set(landedAt(6));
    view.rerender(<EstimateText history={HISTORY} events={upTo(6)} slides={3} clock={clock} />);
    expect(screen.getByTestId("generation-estimate")).toHaveTextContent(
      "About 1 to 2 minutes left",
    );
  });

  test("the late timer waits for the bound and is cleared by any event, even a tick", async () => {
    // A slide's high bound of 400 ms, real timers: still the range at 150 ms, late by 400 ms.
    const quick = {
      ...HISTORY,
      stages: { ...HISTORY.stages, generateSlide: { p50: 300, p80: 400 } },
    };
    const { clock, set } = fakeClock(landedAt(SLIDE_6));
    const view = render(
      <EstimateText history={quick} events={upTo(SLIDE_6)} slides={8} clock={clock} />,
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(screen.getByTestId("generation-estimate").dataset.state).toBe("range");
    await waitFor(() =>
      expect(screen.getByTestId("generation-estimate").dataset.state).toBe("late"),
    );
    // A message-only tick in the same stage is an event: it clears the late state and re-reads.
    const tick = {
      ...upTo(SLIDE_6)[SLIDE_6],
      at: new Date(landedAt(SLIDE_6) + 600).toISOString(),
      progress: { percent: 63, message: "Still on slide 7" },
    } as JobEvent;
    set(landedAt(SLIDE_6) + 600);
    view.rerender(
      <EstimateText history={quick} events={[...upTo(SLIDE_6), tick]} slides={8} clock={clock} />,
    );
    expect(screen.getByTestId("generation-estimate").dataset.state).toBe("range");
  });

  test("says Taking longer than usual past the high bound, until the next event (acceptance 3)", async () => {
    // Slide 6 landed 14 s ago and a slide's high bound is 13 s: the timer is already due.
    const { clock, set } = fakeClock(landedAt(SLIDE_6) + 14_000);
    const view = render(
      <EstimateText history={HISTORY} events={upTo(SLIDE_6)} slides={8} clock={clock} />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("generation-estimate")).toHaveTextContent(TAKING_LONGER_TEXT),
    );
    expect(screen.getByTestId("generation-estimate").dataset.state).toBe("late");
    expect(screen.queryByText(/minutes? left/)).toBeNull();

    // Slide 7 lands: the range is back, narrower than before.
    set(landedAt(SLIDE_6 + 1));
    view.rerender(
      <EstimateText history={HISTORY} events={upTo(SLIDE_6 + 1)} slides={8} clock={clock} />,
    );
    const estimate = screen.getByTestId("generation-estimate");
    expect(estimate.dataset.state).toBe("range");
    expect(estimate).toHaveTextContent("Less than 2 minutes left");
  });
});
