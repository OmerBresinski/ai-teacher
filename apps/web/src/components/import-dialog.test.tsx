import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { demoWorkspace } from "@tj/editor/starter";
import { installFakeApi } from "@/test/fake-api";

/*
 * TEACH-110 rows 8–10: the library Import dialog over the fake api. Files are `File` objects
 * dropped on the zone or chosen through the input; every accepted file becomes one
 * `POST /documents` and the server (here the fake) assigns the id.
 */

const { fakeApi, restore: restoreFetch } = installFakeApi();

const toastSpy = mock();
const actualUi = await import("@tj/ui");
mock.module("@tj/ui", () => ({ ...actualUi, toast: toastSpy }));

const navigate = mock();
const actualRouter = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({ ...actualRouter, useNavigate: () => navigate }));

const { ImportDialog, NOT_JSON_MESSAGE, TOO_LARGE_MESSAGE } = await import("./import-dialog");

const fixture = (key: string) => {
  const item = demoWorkspace(new Date()).find((d) => d.key === key);
  if (!item) throw new Error(`fixture ${key} missing`);
  return item.body;
};
const jsonFile = (name: string, value: unknown) =>
  new File([JSON.stringify(value)], name, { type: "application/json" });

function renderDialog() {
  const onOpenChange = mock();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ImportDialog open onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  );
  return { onOpenChange, queryClient };
}

/** Drop `files` on the zone: what the file input and the drop both feed to `importFiles`. */
function drop(files: File[]) {
  const zone = screen.getByRole("group", { name: "Drop a TeachDeck JSON file to import" });
  fireEvent.drop(zone, { dataTransfer: { files, types: ["Files"] } });
}

const posts = () => fakeApi.requests.filter((r) => r.method === "POST" && r.path === "/documents");
const toasts = () => toastSpy.mock.calls.map((c) => c[0] as string);

describe("ImportDialog", () => {
  beforeEach(() => {
    cleanup();
    fakeApi.reset();
    toastSpy.mockReset();
    navigate.mockReset();
  });
  afterAll(() => {
    mock.restore();
    restoreFetch();
  });

  it("row 8: a lesson and a worksheet dropped together become two POST /documents with new ids", async () => {
    const { onOpenChange } = renderDialog();
    const lesson = fixture("demo-water-cycle");
    const sheet = fixture("fraction-practice");
    const before = fakeApi.live().length;

    drop([jsonFile("a.teachdeck.json", lesson), jsonFile("b.worksheet.json", sheet)]);

    await waitFor(() => expect(posts()).toHaveLength(2));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(posts().map((r) => (r.body as { kind: string }).kind)).toEqual(["lesson", "worksheet"]);
    const rows = fakeApi.live();
    expect(rows).toHaveLength(before + 2);
    // Server-assigned ids: neither new row carries the file's id.
    const created = rows.filter((r) => r.id !== lesson.id && r.id !== sheet.id && r.id.length > 20);
    expect(created.map((r) => r.body.title).sort()).toEqual([lesson.title, sheet.title].sort());
    expect(toasts()).toEqual(["Imported 2 documents"]);
  });

  it("a single import toasts the title with an Open action to the new document", async () => {
    renderDialog();
    const sheet = fixture("fraction-practice");
    drop([jsonFile("b.worksheet.json", sheet)]);
    await waitFor(() => expect(toastSpy).toHaveBeenCalledTimes(1));
    const [message, options] = toastSpy.mock.calls[0] as [
      string,
      { action: { label: string; onClick: () => void } },
    ];
    expect(message).toBe(`Imported “${sheet.title}”`);
    expect(options.action.label).toBe("Open");
    options.action.onClick();
    const created = posts()[0];
    expect(navigate).toHaveBeenCalledWith({
      to: "/w/$worksheetId",
      params: { worksheetId: expect.not.stringMatching(new RegExp(`^${sheet.id}$`)) },
    });
    expect(created).toBeDefined();
  });

  it("row 9: a newer document version is refused with TeachDeck's copy and nothing is created", async () => {
    const { onOpenChange } = renderDialog();
    drop([jsonFile("new.teachdeck.json", { ...fixture("demo-water-cycle"), version: 2 })]);
    await waitFor(() => expect(toastSpy).toHaveBeenCalledTimes(1));
    expect(toasts()[0]).toBe(
      "Could not import “new.teachdeck.json”. This file was made with a newer version of TeachDeck (document version 2).",
    );
    expect(posts()).toHaveLength(0);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("row 10: a file that is not JSON fails on its own; the others still import", async () => {
    renderDialog();
    const bad = new File(["hello"], "broken.json", { type: "application/json" });
    drop([bad, jsonFile("a.teachdeck.json", fixture("demo-water-cycle"))]);
    await waitFor(() => expect(posts()).toHaveLength(1));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledTimes(2));
    expect(toasts()[0]).toBe('Could not import “broken.json”. "broken.json" is not a JSON file.');
    expect(toasts()[1]).toMatch(/^Imported “/);
  });

  it("rejects a drop with no JSON files at all", async () => {
    renderDialog();
    drop([new File(["x"], "notes.txt", { type: "text/plain" })]);
    await waitFor(() => expect(toasts()).toEqual([NOT_JSON_MESSAGE]));
    expect(posts()).toHaveLength(0);
  });

  it("surfaces the api's 413 as the size limit", async () => {
    renderDialog();
    fakeApi.failNext(
      (r) => r.method === "POST" && r.path === "/documents",
      () =>
        new Response(JSON.stringify({ error: { code: "payload_too_large", message: "x" } }), {
          status: 413,
          headers: { "content-type": "application/json" },
        }),
    );
    drop([jsonFile("big.teachdeck.json", fixture("demo-water-cycle"))]);
    await waitFor(() => expect(toastSpy).toHaveBeenCalledTimes(1));
    expect(toasts()[0]).toBe(`Could not import “big.teachdeck.json”. ${TOO_LARGE_MESSAGE}`);
  });
});
