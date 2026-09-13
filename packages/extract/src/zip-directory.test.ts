import { describe, expect, spyOn, test } from "bun:test";
import JSZip from "jszip";
import { openZip } from "./mime";
import { resolveLimits } from "./types";
import { checkZipDirectory } from "./zip-directory";

async function archive(count: number) {
  const zip = new JSZip();
  for (let index = 0; index < count; index++) zip.file(`entry-${index}.txt`, "synthetic");
  return zip.generateAsync({ type: "uint8array" });
}

describe("bounded ZIP directory admission", () => {
  test("too many entries are rejected before invoking JSZip", async () => {
    const bytes = await archive(20);
    const load = spyOn(JSZip, "loadAsync");
    try {
      await expect(
        openZip(bytes, "docx", resolveLimits({ maxZipEntries: 10 })),
      ).rejects.toMatchObject({ code: "too-large" });
      expect(load).not.toHaveBeenCalled();
    } finally {
      load.mockRestore();
    }
  });

  test("forged small counts cannot bypass the actual record count", async () => {
    const bytes = await archive(20);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    view.setUint16(bytes.length - 22 + 8, 1, true);
    view.setUint16(bytes.length - 22 + 10, 1, true);
    expect(() => checkZipDirectory(bytes, 10, "docx")).toThrow(
      expect.objectContaining({ code: "too-large" }),
    );
  });

  test("valid archives and boundary counts still parse", async () => {
    const bytes = await archive(10);
    expect(() => checkZipDirectory(bytes, 10, "docx")).not.toThrow();
    expect(
      Object.keys((await openZip(bytes, "docx", resolveLimits({ maxZipEntries: 10 }))).files),
    ).toHaveLength(10);
  });

  test("truncated and ambiguous offset layouts are rejected", async () => {
    const bytes = await archive(2);
    expect(() => checkZipDirectory(bytes.subarray(0, bytes.length - 1), 10, "docx")).toThrow();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    view.setUint32(bytes.length - 22 + 16, 0xffffffff, true);
    expect(() => checkZipDirectory(bytes, 10, "docx")).toThrow(
      expect.objectContaining({ code: "malformed" }),
    );
  });
});
