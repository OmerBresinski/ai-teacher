import { describe, expect, test } from "bun:test";
import { newId, storageKey, type WorkspaceId } from "@tj/domain";
import { downloadHeaders, INLINE_SAFE_TYPES, safeContentType } from "./headers";

const workspaceId = newId<WorkspaceId>();

function key(filename: string) {
  return storageKey(workspaceId, "exports", filename);
}

describe("safeContentType", () => {
  test("neutralises executable and unparseable media types", () => {
    for (const contentType of [
      "text/html",
      "application/xhtml+xml",
      "image/svg+xml",
      "text/xml",
      "application/xml",
      "text/javascript",
      "application/x-ecmascript",
      "",
      "not a media type",
    ]) {
      expect(safeContentType(contentType)).toBe("application/octet-stream");
    }
  });

  test("preserves non-executable stored types verbatim", () => {
    expect(
      safeContentType("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    ).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(safeContentType("text/plain; charset=utf-8")).toBe("text/plain; charset=utf-8");
  });
});

describe("downloadHeaders", () => {
  test("uses inline disposition for the allow-list", () => {
    expect(INLINE_SAFE_TYPES).toEqual(
      new Set(["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"]),
    );
    expect(downloadHeaders({ key: key("lesson 1.pdf"), contentType: "application/pdf" })).toEqual({
      "content-type": "application/pdf",
      "content-disposition": "inline; filename=\"lesson 1.pdf\"; filename*=UTF-8''lesson%201.pdf",
      "content-security-policy": "default-src 'none'; sandbox",
    });
    expect(
      downloadHeaders({ key: key("versioned.pdf"), contentType: "Application/PDF; version=1.7" }),
    ).toMatchObject({
      "content-type": "Application/PDF; version=1.7",
      "content-disposition": "inline; filename=\"versioned.pdf\"; filename*=UTF-8''versioned.pdf",
    });
    expect(
      downloadHeaders({ key: key("lesson.png"), contentType: "image/png" })["content-disposition"],
    ).toBe("inline; filename=\"lesson.png\"; filename*=UTF-8''lesson.png");
  });

  test("uses attachment disposition for neutralised, document, and text types", () => {
    for (const { filename, contentType, expectedType } of [
      { filename: "evil.html", contentType: "text/html", expectedType: "application/octet-stream" },
      {
        filename: "image.svg",
        contentType: "image/svg+xml",
        expectedType: "application/octet-stream",
      },
      {
        filename: "script.js",
        contentType: "text/javascript",
        expectedType: "application/octet-stream",
      },
      {
        filename: "lesson.docx",
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        expectedType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      },
      {
        filename: "notes.txt",
        contentType: "text/plain; charset=utf-8",
        expectedType: "text/plain; charset=utf-8",
      },
      {
        filename: "unknown.bin",
        contentType: "not a media type",
        expectedType: "application/octet-stream",
      },
    ]) {
      const headers = downloadHeaders({ key: key(filename), contentType });
      expect(headers["content-type"]).toBe(expectedType);
      expect(headers["content-disposition"]).toStartWith(`attachment; filename="${filename}"`);
    }
  });

  test("uses an ASCII fallback and UTF-8 filename parameter", () => {
    expect(
      downloadHeaders({ key: key('weird"nameé.bin'), contentType: "application/octet-stream" }),
    ).toMatchObject({
      "content-disposition":
        "attachment; filename=\"weird_name_.bin\"; filename*=UTF-8''weird%22name%C3%A9.bin",
    });
  });
});
