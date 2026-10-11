import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LazyPart, lazyLoader, RetryLoad } from "./LazyPart";

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
});
