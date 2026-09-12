import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SourceRef } from "@tj/domain/documents";
import { TooltipProvider } from "@tj/ui";
import { useState } from "react";
import { installFakeApi } from "@/test/fake-api";
import { COPYRIGHT_NOTICE, LIMIT_NOTICE, SourceDropZone } from "./SourceDropZone";

const { fakeApi, restore } = installFakeApi();

/** The zone as the brief mounts it: the parent owns the list. */
function Harness({ initial = [] as SourceRef[] }: { initial?: SourceRef[] }) {
  const [sources, setSources] = useState<SourceRef[]>(initial);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <SourceDropZone sources={sources} onChange={setSources} onBusyChange={setBusy} />
      <output data-testid="ids">{sources.map((s) => s.id).join(",")}</output>
      <output data-testid="busy">{String(busy)}</output>
    </>
  );
}

function renderZone(initial?: SourceRef[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Harness initial={initial} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

const pdf = (name = "plants.pdf", bytes = 1400) =>
  new File([new Uint8Array(bytes)], name, { type: "application/pdf" });
const fileInput = () => screen.getByLabelText("Choose files", { selector: "input" });
const ids = () => screen.getByTestId("ids").textContent ?? "";
const uploads = () => fakeApi.requests.filter((r) => r.path === "/sources" && r.method === "POST");

describe("SourceDropZone", () => {
  beforeEach(() => {
    fakeApi.reset();
    fakeApi.requests.length = 0;
  });
  afterEach(() => cleanup());
  afterAll(() => restore());

  it("renders the controls and the copyright line with no chips", () => {
    renderZone();
    expect(screen.getByRole("button", { name: "Choose files" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Paste text instead" })).toBeEnabled();
    expect(screen.getByText(COPYRIGHT_NOTICE)).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Your material" })).toBeNull();
  });

  it("a chosen PDF is uploaded as multipart and becomes a chip with its page count", async () => {
    renderZone();
    fireEvent.change(fileInput(), { target: { files: [pdf()] } });
    expect(screen.getByTestId("busy").textContent).toBe("true");
    await screen.findByRole("button", { name: "Remove plants.pdf" });
    expect(screen.getByText("2 pages")).toBeTruthy();
    expect(uploads()).toHaveLength(1);
    const first = uploads()[0]?.body;
    expect(first).toBeInstanceOf(FormData);
    expect((first as FormData).get("file")).toBeInstanceOf(File);
    expect(ids()).toBe([...fakeApi.sources.keys()][0] ?? "none");
    await waitFor(() => expect(screen.getByTestId("busy").textContent).toBe("false"));
  });

  it("a PPTX shows slides; a paste shows text", async () => {
    renderZone();
    fireEvent.change(fileInput(), { target: { files: [pdf("deck.pptx")] } });
    await screen.findByText("30 slides");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Paste text instead" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Text to use as material" }), {
      target: { value: "Some pasted material." },
    });
    await user.click(screen.getByRole("button", { name: "Add" }));
    await screen.findByRole("button", { name: "Remove Pasted text" });
    expect(screen.getByText("text")).toBeTruthy();
    const second = uploads()[1]?.body;
    expect((second as FormData).get("text")).toBe("Some pasted material.");
  });

  it("a refusal shows the API's sentence verbatim, is announced, adds no chip, and can be dismissed", async () => {
    renderZone();
    fireEvent.change(fileInput(), { target: { files: [pdf("year5-roster.pdf")] } });
    // Once in the notice list, once in the polite live region.
    const shown = await screen.findAllByText(/This looks like a class list/);
    expect(shown).toHaveLength(2);
    expect(shown[0]?.textContent).toContain('the section "Class 5B"');
    expect(shown.some((el) => el.closest("[aria-live=polite]") !== null)).toBe(true);
    expect(screen.queryByRole("list", { name: "Your material" })).toBeNull();
    expect(ids()).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("list", { name: "Files we could not take" })).toBeNull();
  });

  it("a file over 25 MB is refused client-side with no request", async () => {
    renderZone();
    fireEvent.change(fileInput(), { target: { files: [pdf("huge.pdf", 25 * 1024 * 1024 + 1)] } });
    await screen.findAllByText(/This file is over 25 MB/);
    expect(uploads()).toHaveLength(0);
  });

  it("uploads run one at a time, and a fourth file is not taken", async () => {
    renderZone();
    fireEvent.change(fileInput(), {
      target: { files: [pdf("a.pdf"), pdf("b.pdf"), pdf("c.pdf"), pdf("d.pdf")] },
    });
    await screen.findByRole("button", { name: "Remove c.pdf" });
    expect(screen.queryByRole("button", { name: "Remove d.pdf" })).toBeNull();
    expect(uploads()).toHaveLength(3);
    expect(screen.getByText(LIMIT_NOTICE, { selector: "p.text-body" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Choose files" })).toBeDisabled();
  });

  it("removing a chip calls DELETE and drops the id", async () => {
    renderZone();
    fireEvent.change(fileInput(), { target: { files: [pdf()] } });
    const remove = await screen.findByRole("button", { name: "Remove plants.pdf" });
    const id = ids();
    expect(id).not.toBe("");
    fireEvent.click(remove);
    await waitFor(() => expect(ids()).toBe(""));
    expect(screen.queryByRole("button", { name: "Remove plants.pdf" })).toBeNull();
    expect(fakeApi.requests.some((r) => r.method === "DELETE" && r.path === `/sources/${id}`)).toBe(
      true,
    );
  });

  it("a drop on the zone uploads the files", async () => {
    renderZone();
    const zone = screen.getByTestId("source-drop-zone");
    fireEvent.drop(zone, { dataTransfer: { files: [pdf("dropped.pdf")], types: ["Files"] } });
    await screen.findByRole("button", { name: "Remove dropped.pdf" });
  });
});
