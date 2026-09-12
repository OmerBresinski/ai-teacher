/**
 * Export phase E3 (TEACH-112 row 4; ADR 0023 §4): Word from the worksheet editor's export dialog,
 * loaded on click. The file is a zip; `word/document.xml` is read back with jszip.
 */
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { expect, test } from "./fixtures";

test("Export → Word downloads <slug>.docx with a real document part", async ({
  signedInPage: { page, paths },
}) => {
  await page.goto(paths.worksheet("fraction-practice"));
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export" });
  await dialog.getByRole("tab", { name: "Word" }).click();
  // The seeded sheet ships without a key, so the switch follows it off (ADR 0023 §7).
  await expect(dialog.getByRole("switch", { name: "Include answer key" })).toHaveAttribute(
    "aria-checked",
    "false",
  );
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Export Word" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("fractions-practice.docx");
  const bytes = readFileSync(await file.path());
  expect(bytes.byteLength).toBeGreaterThan(5_000);
  const zip = await JSZip.loadAsync(bytes);
  expect(Object.keys(zip.files)).toContain("word/document.xml");
  const xml = await zip.file("word/document.xml")?.async("string");
  expect(xml).toContain("Fractions practice");
  expect(xml).not.toContain("Answer key");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Worksheet exported as Word")).toBeVisible();
});
