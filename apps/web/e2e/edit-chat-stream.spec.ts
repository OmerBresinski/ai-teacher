import { expect, test } from "./fixtures";

/*
 * Edit with Dayback, streamed (TEACH-97 chat-d): ask → the answer streams into the reply and its
 * change card → the checked answer applies to the slide → Undo puts the text back. The edit route
 * is answered here with an SSE body (the e2e api has no model): a `partial`, then `final`. The
 * request must accept `text/event-stream`; the guards in front of it are covered by smoke-prod.
 */

test("ask, stream, result, undo", async ({ signedInPage: { page, paths } }) => {
  await page.goto(paths.lesson("demo-water-cycle"));
  const frame = page.locator("[data-slide-frame]").first();
  await expect(frame).toBeVisible();
  const bubble = page.locator("[data-edit-chat-bubble]");
  if (await bubble.isVisible()) await bubble.click();
  const pane = page.getByRole("complementary", { name: "Edit with Dayback" });
  await expect(pane).toBeVisible();

  let accept = "";
  await page.route("**/lessons/*/edit", async (route) => {
    accept = route.request().headers().accept ?? "";
    const { elementId } = route.request().postDataJSON() as { elementId: string };
    const partial = { summary: "Made it shorter.", texts: [{ elementId, text: "Rain falls" }] };
    const final = {
      action: "edit",
      summary: "Made it shorter.",
      changes: [
        {
          elementId,
          doc: {
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "text", text: "Rain falls." }] }],
          },
        },
      ],
    };
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: `event: partial\ndata: ${JSON.stringify(partial)}\n\nevent: final\ndata: ${JSON.stringify(final)}\n\n`,
    });
  });

  const target = frame.getByText(/Where rain/);
  await expect(target).toBeVisible();
  const before = await target.innerText();
  // The selection layer sits over the slide: click where the text is, as a teacher does.
  // `boundingBox()` does not wait: it answers null while the canvas swaps the text node for its
  // re-fitted one (seen in CI right after `toBeVisible` passed), so wait for the settled box.
  let settled: Awaited<ReturnType<typeof target.boundingBox>> = null;
  await expect(async () => {
    settled = await target.boundingBox();
    expect(settled, "no text box on the slide").not.toBeNull();
  }).toPass({ timeout: 5_000 });
  const box = settled as Awaited<ReturnType<typeof target.boundingBox>>;
  if (!box) throw new Error("no text box on the slide");
  await page.mouse.click(box.x + box.width / 2, box.y + Math.min(12, box.height / 2));
  await pane.getByRole("button", { name: "Shorter", exact: true }).click();

  const card = pane.locator("[data-edit-card]").last();
  await expect(card.locator("[data-edit-late-after]")).toHaveText("Rain falls.");
  expect(accept).toContain("text/event-stream");
  await expect(frame).toContainText("Rain falls.");
  await expect(pane.getByText("Made it shorter.")).toBeVisible();

  await card.getByRole("button", { name: "Undo" }).click();
  await expect(frame).toContainText(before);
  await expect(card.getByRole("button", { name: "Undone" })).toBeDisabled();
});
