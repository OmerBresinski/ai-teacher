import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { failedModuleUrl, freshUrl, LazyPart, lazyLoader, RetryLoad } from "./LazyPart";

afterEach(cleanup);

function Picker({ label }: { label: string }) {
  return <p>{label}</p>;
}

describe("LazyPart", () => {
  test("a failed chunk fetch shows a retry in place; the retry imports again and paints", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);
    const error = spyOn(console, "error").mockImplementation(() => undefined);
    let calls = 0;
    const loader = lazyLoader<{ label: string }>(() => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new TypeError("Failed to fetch dynamically imported module"))
        : Promise.resolve(Picker);
    });
    render(
      <div>
        <p>editor</p>
        <LazyPart
          loader={loader}
          props={{ label: "picker" }}
          fallback={<span>loading</span>}
          failed={(retry) => <RetryLoad onRetry={retry} />}
        />
      </div>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Couldn't load. Retry" }));
    expect(await screen.findByText("picker")).toBeInTheDocument();
    // The rest of the tree never unmounted.
    expect(screen.getByText("editor")).toBeInTheDocument();
    expect(calls).toBe(2);
    warn.mockRestore();
    error.mockRestore();
  });

  test("a failed preload is swallowed and forgotten, so the render imports again", async () => {
    let calls = 0;
    const loader = lazyLoader<{ label: string }>(() => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error("offline")) : Promise.resolve(Picker);
    });
    loader.preload();
    await new Promise((r) => setTimeout(r, 0));
    render(
      <LazyPart loader={loader} props={{ label: "ready" }} fallback={null} failed={() => null} />,
    );
    expect(await screen.findByText("ready")).toBeInTheDocument();
    expect(calls).toBe(2);
  });

  test("a part mounted after its import landed renders at once, with no fallback", async () => {
    const loader = lazyLoader<{ label: string }>(() => Promise.resolve(Picker));
    await loader.preload();
    expect(loader.ready()).toBe(Picker);
    render(
      <LazyPart
        loader={loader}
        props={{ label: "picker" }}
        fallback={<span>loading</span>}
        failed={(retry) => <RetryLoad onRetry={retry} />}
      />,
    );
    expect(screen.getByText("picker")).toBeInTheDocument();
    expect(screen.queryByText("loading")).toBeNull();
  });

  test("a retry after a failed chunk imports the chunk's URL afresh (browsers cache the failure)", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);
    const error = spyOn(console, "error").mockImplementation(() => undefined);
    const chunk = "https://app.test/assets/chat-parts-Ab12.js";
    const fresh: string[] = [];
    let plain = 0;
    const loader = lazyLoader(
      () => {
        plain += 1;
        return Promise.reject(
          new TypeError(`Failed to fetch dynamically imported module: ${chunk}`),
        );
      },
      (m: { Part: typeof Picker }) => m.Part,
      (url) => {
        fresh.push(url);
        return Promise.resolve({ Part: Picker });
      },
    );
    // A failed preload settles quietly.
    expect(await loader.preload()).toBeUndefined();
    expect(loader.ready()).toBeNull();
    render(
      <LazyPart
        loader={loader}
        props={{ label: "picker" }}
        fallback={<span>loading</span>}
        failed={(retry) => <RetryLoad onRetry={retry} />}
      />,
    );
    expect(await screen.findByText("picker")).toBeInTheDocument();
    expect(plain).toBe(1);
    expect(fresh).toHaveLength(1);
    expect(fresh[0]).toStartWith(`${chunk}?t=`);
    warn.mockRestore();
    error.mockRestore();
  });

  test("failedModuleUrl reads the chunk URL from Chrome's and Firefox's messages", () => {
    expect(
      failedModuleUrl(
        new TypeError("Failed to fetch dynamically imported module: https://a.test/assets/x-1.js"),
      ),
    ).toBe("https://a.test/assets/x-1.js");
    expect(
      failedModuleUrl(new TypeError("error loading dynamically imported module: /assets/y.js")),
    ).toBe("/assets/y.js");
    expect(failedModuleUrl(new TypeError("Importing a module script failed."))).toBeNull();
    expect(freshUrl("https://a.test/assets/x-1.js?t=1", 2)).toBe(
      "https://a.test/assets/x-1.js?t=2",
    );
  });
});
