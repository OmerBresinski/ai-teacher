import { describe, expect, test } from "bun:test";
import { notifyManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { starterWorksheet } from "../model/worksheet-factories";
import { setTitle } from "./reducers";
import { useTypingSessionState } from "./typing-session";
import { useWorksheetHistory } from "./use-worksheet-history";

/*
 * TeachDeck `lib/worksheet/__tests__/typing-session.test.ts` (5), on the real history hook: a burst
 * of writes is one undo step, a pause splits it, undo/redo close the open session first, and
 * `end` is idempotent. `bun test` has no fake timers, so the idle window is 20 ms here.
 */

const KEY = ["library", "documents", "W1"] as const;
const IDLE = 20;

// Deliver observer notifications synchronously so `worksheet` never lags the cache in assertions.
notifyManager.setScheduler((callback) => callback());
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const seed = starterWorksheet("Seed");
  client.setQueryData(KEY, seed);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    () => {
      const history = useWorksheetHistory({ queryKey: KEY, queryFn: () => Promise.resolve(seed) });
      const typing = useTypingSessionState(history, IDLE);
      return { history, typing };
    },
    { wrapper },
  );
  const type = (text: string) => {
    for (let i = 1; i <= text.length; i++) {
      const slice = text.slice(0, i);
      act(() =>
        hook.result.current.typing.run(() => hook.result.current.history.dispatch(setTitle, slice)),
      );
    }
  };
  const title = () => hook.result.current.history.worksheet?.title;
  return { ...hook, type, title };
}

describe("typing session", () => {
  test("a burst of writes is one undo step", async () => {
    const { result, type, title } = setup();
    type("abc");
    expect(title()).toBe("abc");
    expect(result.current.typing.isOpen()).toBe(true);
    await act(() => wait(IDLE * 2));
    expect(result.current.typing.isOpen()).toBe(false);
    act(() => result.current.history.undo());
    expect(title()).toBe("Seed");
    expect(result.current.history.canUndo).toBe(false);
  });

  test("a pause longer than the idle window splits two bursts", async () => {
    const { result, type, title } = setup();
    type("ab");
    await act(() => wait(IDLE * 2));
    type("abcd");
    await act(() => wait(IDLE * 2));
    act(() => result.current.history.undo());
    expect(title()).toBe("ab");
    act(() => result.current.history.undo());
    expect(title()).toBe("Seed");
  });

  test("undo closes an open session first, so the burst just typed is what comes off", () => {
    const { result, type, title } = setup();
    type("abc");
    expect(result.current.typing.isOpen()).toBe(true);
    act(() => result.current.typing.undo());
    expect(result.current.typing.isOpen()).toBe(false);
    expect(title()).toBe("Seed");
    act(() => result.current.typing.redo());
    expect(title()).toBe("abc");
  });

  test("end commits at once and is idempotent", () => {
    const { result, type, title } = setup();
    type("xy");
    act(() => result.current.typing.end());
    act(() => result.current.typing.end());
    expect(result.current.typing.isOpen()).toBe(false);
    expect(result.current.history.canUndo).toBe(true);
    act(() => result.current.history.undo());
    expect(title()).toBe("Seed");
    // Nothing else was recorded by the second end.
    expect(result.current.history.canUndo).toBe(false);
  });

  test("a write after end opens a new session and a new step", async () => {
    const { result, type, title } = setup();
    type("a");
    act(() => result.current.typing.end());
    type("ab");
    await act(() => wait(IDLE * 2));
    act(() => result.current.history.undo());
    expect(title()).toBe("a");
  });
});
