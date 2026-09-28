import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import {
  CAPTCHA_HEADER,
  captchaHeaders,
  isCaptchaError,
  loadTurnstile,
  resetTurnstileLoaderForTests,
  TURNSTILE_SCRIPT_URL,
  type TurnstileApi,
  type TurnstileRenderOptions,
} from "./load-turnstile";
import { type TurnstileToken, TurnstileWidget, useTurnstileToken } from "./use-turnstile-token";

/** A stand-in for Cloudflare's `window.turnstile`: the test drives the callbacks. */
function fakeTurnstile() {
  const widgets: { el: HTMLElement; options: TurnstileRenderOptions }[] = [];
  const api: TurnstileApi = {
    render: mock((el: HTMLElement, options: TurnstileRenderOptions) => {
      widgets.push({ el, options });
      return `w${widgets.length}`;
    }),
    reset: mock(),
    remove: mock(),
    getResponse: mock(),
  };
  return { api, widgets, last: () => widgets.at(-1)?.options };
}

let fake: ReturnType<typeof fakeTurnstile>;

function Harness({ onReady, siteKey }: { onReady: (t: TurnstileToken) => void; siteKey?: string }) {
  const turnstile = useTurnstileToken({ siteKey, action: "magic-link", timeoutMs: 200 });
  onReady(turnstile);
  return <TurnstileWidget turnstile={turnstile} />;
}

function mountHarness(siteKey: string | undefined = "1x00000000000000000000AA") {
  let current: TurnstileToken | undefined;
  const view = render(<Harness siteKey={siteKey} onReady={(t) => (current = t)} />);
  return { view, get: () => current as TurnstileToken };
}

describe("useTurnstileToken", () => {
  beforeEach(() => {
    fake = fakeTurnstile();
    window.turnstile = fake.api;
  });
  afterEach(() => {
    delete window.turnstile;
    resetTurnstileLoaderForTests();
  });

  it("is off without a site key: no widget, no script, getToken resolves null", async () => {
    delete window.turnstile;
    const { result } = renderHook(() => useTurnstileToken({ siteKey: undefined }));
    expect(result.current.enabled).toBe(false);
    expect(await result.current.getToken()).toBeNull();
    const { container } = render(<TurnstileWidget turnstile={result.current} />);
    expect(container.innerHTML).toBe("");
    expect(document.querySelector(`script[src="${TURNSTILE_SCRIPT_URL}"]`)).toBeNull();
  });

  it("renders a managed, interaction-only widget with the site key and action", async () => {
    mountHarness();
    await waitFor(() => expect(fake.widgets).toHaveLength(1));
    expect(fake.last()).toMatchObject({
      sitekey: "1x00000000000000000000AA",
      action: "magic-link",
      appearance: "interaction-only",
      "refresh-expired": "auto",
    });
  });

  it("hands out a token that is ready, once (single use)", async () => {
    const h = mountHarness();
    await waitFor(() => expect(fake.widgets).toHaveLength(1));
    act(() => fake.last()?.callback?.("tok-1"));
    expect(await h.get().getToken()).toBe("tok-1");
    // Consumed: the next call waits for a fresh challenge.
    const next = h.get().getToken();
    act(() => fake.last()?.callback?.("tok-2"));
    expect(await next).toBe("tok-2");
  });

  it("waits for a challenge still running when the form submits", async () => {
    const h = mountHarness();
    await waitFor(() => expect(fake.widgets).toHaveLength(1));
    const pending = h.get().getToken();
    act(() => fake.last()?.callback?.("late"));
    expect(await pending).toBe("late");
  });

  it("rejects waiting callers when the challenge errors, and reports it", async () => {
    const h = mountHarness();
    await waitFor(() => expect(fake.widgets).toHaveLength(1));
    const pending = h.get().getToken();
    let handled: boolean | undefined;
    act(() => {
      handled = fake.last()?.["error-callback"]?.("300030");
    });
    await expect(pending).rejects.toThrow(/failed/);
    expect(handled).toBe(true);
    expect(h.get().error).toBe("failed");
  });

  it("after a failed challenge getToken rejects at once, and reset() lets it wait again", async () => {
    const h = mountHarness();
    await waitFor(() => expect(fake.widgets).toHaveLength(1));
    act(() => {
      fake.last()?.["error-callback"]?.("300030");
    });
    await expect(h.get().getToken()).rejects.toThrow(/failed/);
    act(() => h.get().reset());
    const pending = h.get().getToken();
    act(() => fake.last()?.callback?.("after-reset"));
    expect(await pending).toBe("after-reset");
  });

  it("rejects after the timeout when no token arrives", async () => {
    const h = mountHarness();
    await waitFor(() => expect(fake.widgets).toHaveLength(1));
    await expect(h.get().getToken()).rejects.toThrow(/timed out/);
    await waitFor(() => expect(h.get().error).toBe("failed"));
  });

  it("an expired token is dropped rather than sent", async () => {
    const h = mountHarness();
    await waitFor(() => expect(fake.widgets).toHaveLength(1));
    act(() => fake.last()?.callback?.("old"));
    act(() => fake.last()?.["expired-callback"]?.());
    const pending = h.get().getToken();
    act(() => fake.last()?.callback?.("fresh"));
    expect(await pending).toBe("fresh");
  });

  it("reset() drops the token and restarts the widget; unmount removes it", async () => {
    const h = mountHarness();
    await waitFor(() => expect(fake.widgets).toHaveLength(1));
    act(() => fake.last()?.callback?.("tok"));
    act(() => h.get().reset());
    expect(fake.api.reset).toHaveBeenCalledWith("w1");
    h.view.unmount();
    expect(fake.api.remove).toHaveBeenCalledWith("w1");
  });
});

describe("loadTurnstile", () => {
  // happy-dom would really fetch the script; capture it instead and fire its events by hand.
  let injected: HTMLScriptElement[];
  let appendSpy: ReturnType<typeof spyOn<HTMLHeadElement, "appendChild">>;
  beforeEach(() => {
    injected = [];
    appendSpy = spyOn(document.head, "appendChild").mockImplementation(
      <T extends Node>(node: T) => {
        injected.push(node as unknown as HTMLScriptElement);
        return node;
      },
    );
  });
  afterEach(() => {
    appendSpy.mockRestore();
    delete window.turnstile;
    resetTurnstileLoaderForTests();
  });

  it("injects the explicit-render script once and resolves window.turnstile on load", async () => {
    const first = loadTurnstile();
    const second = loadTurnstile();
    expect(injected.map((s) => s.src)).toEqual([TURNSTILE_SCRIPT_URL]);
    const api = fakeTurnstile().api;
    window.turnstile = api;
    injected[0]?.onload?.(new Event("load"));
    expect(await first).toBe(api);
    expect(await second).toBe(api);
  });

  it("a failed load rejects and can be retried", async () => {
    const first = loadTurnstile();
    injected[0]?.onerror?.(new Event("error"));
    await expect(first).rejects.toThrow(/failed to load/);
    void loadTurnstile().catch(() => {});
    expect(injected).toHaveLength(2);
  });
});

describe("helpers", () => {
  it("captchaHeaders sends the header only with a token", () => {
    expect(captchaHeaders("t")).toEqual({ [CAPTCHA_HEADER]: "t" });
    expect(captchaHeaders(null)).toEqual({});
    expect(CAPTCHA_HEADER).toBe("x-captcha-response");
  });

  it("isCaptchaError matches better-auth's captcha codes only", () => {
    expect(isCaptchaError({ status: 400, code: "MISSING_RESPONSE" })).toBe(true);
    expect(isCaptchaError({ status: 403, code: "VERIFICATION_FAILED" })).toBe(true);
    expect(isCaptchaError({ status: 500, code: "UNKNOWN_ERROR" })).toBe(false);
    expect(isCaptchaError(null)).toBe(false);
  });
});
