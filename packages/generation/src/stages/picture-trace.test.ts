import { describe, expect, test } from "bun:test";
import { ImageGenerationError, PictureStageError } from "@tj/images";
import { failedChecks } from "./illustrate";
import {
  type BankRequest,
  type FrameMeasure,
  findPicture,
  JUDGE_CHECKS,
  type MadePicture,
  type PictureBank,
} from "./photo-bank";
import { keyStageOf, lessonSubjectOf, pictureKindOf, traceProps } from "./picture-trace";

const signal = new AbortController().signal;
const req: BankRequest = {
  text: "a hen beside a chick",
  named: null,
  route: "generic",
  imagePrompt: "a hen beside a chick on straw",
};
const frame = (cut: boolean): FrameMeasure => ({
  plain: true,
  cut,
  bleed: cut ? 0.4 : 0,
  edges: { top: cut ? 0.3 : 0, right: 0, bottom: 0, left: cut ? 0.1 : 0 },
  ms: 12,
});
const made = (n: number, cut = false): MadePicture => ({
  src: `/files/w/images/g${n}.png`,
  alt: "a hen",
  source: {
    provider: "generated",
    id: `g${n}`,
    pageUrl: "https://openai.com/policies/",
    photographer: "AI-generated (m)",
    photographerUrl: "https://openai.com/policies/",
  },
  evidence: { visible: [], count: "one", alt: "a hen", promptVersion: "t" },
  dataUrl: "data:image/png;base64,AA==",
  costUsd: 0.04,
  frame: frame(cut),
});
const bank = (generate: PictureBank["generate"]): PictureBank => ({
  lookup: async () => undefined,
  remember: async () => undefined,
  generate,
  reject: async () => undefined,
});

describe("findPicture's trace (picture tracing, 21 Oct 2026)", () => {
  test("a judge refusal records its failed checks; the retry placed is marked with its frame and cost", async () => {
    let n = 0;
    const out = await findPicture(
      req,
      bank(async () => made(++n, n === 1)),
      async () => undefined,
      signal,
      async (_p, _reuse, onWhy) => {
        if (n === 1) {
          onWhy?.("the chick is missing", ["misfit", "items-missing"]);
          return false;
        }
        return true;
      },
    );
    expect(out.via).toBe("generated");
    expect(out.reason).toBe("judge");
    expect(out.trace.attempts.map((a) => a.result)).toEqual(["judge", "placed"]);
    expect(out.trace.attempts[0]).toMatchObject({
      failedChecks: ["misfit", "items-missing"],
      why: "the chick is missing",
      costUsd: 0.04,
    });
    const props = traceProps(out.trace, out.photo?.src, "object");
    expect(props).toMatchObject({
      retryReasons: ["judge"],
      failedChecks: ["misfit", "items-missing"],
      judgeRefusals: 1,
      pictureCostUsd: 0.08,
      frameMeasured: true,
      frameCut: false,
      cutsSeen: 1,
    });
    expect(props.portraitCut).toBeUndefined();
  });

  test("a bank that declines (daily cap) is recorded, not silent", async () => {
    const out = await findPicture(
      req,
      bank(async () => undefined),
      async () => undefined,
      signal,
      async () => true,
    );
    expect(out.photo).toBeUndefined();
    expect(out.reason).toBe("declined");
    expect(out.trace.attempts).toEqual([{ result: "declined" }]);
  });

  test("a judge call that fails is judge-error, apart from a refusal", async () => {
    let n = 0;
    const out = await findPicture(
      req,
      bank(async () => made(++n)),
      async () => undefined,
      signal,
      async () => {
        throw new Error("judge down");
      },
    );
    expect(out.photo).toBeUndefined();
    expect(out.reason).toBe("judge-error");
    expect(out.trace.attempts.every((a) => a.result === "judge-error")).toBe(true);
  });

  test("a generator failure is its code on the trace", async () => {
    const out = await findPicture(
      req,
      bank(async () => {
        throw new ImageGenerationError("busy", "server-error", 2);
      }),
      async () => undefined,
      signal,
      async () => true,
    );
    expect(out.trace.attempts).toEqual([
      {
        result: "server-error",
        failure: {
          stage: "generate",
          error: "ImageGenerationError",
          code: "server-error",
          message: "busy",
        },
      },
    ]);
    expect(traceProps(out.trace, undefined, "object").retryReasons).toEqual(["server-error"]);
  });

  test("a stock picture placed says so, and has no frame measure", async () => {
    const out = await findPicture(
      { ...req, route: "real" },
      bank(async () => made(1)),
      async () => made(9),
      signal,
    );
    expect(out.via).toBe("fetched");
    expect(out.trace.stock).toBe("placed");
    expect(traceProps(out.trace, out.photo?.src, "object").frameMeasured).toBe(false);
  });
});

describe("a portrait's frame cut is recorded apart (most are cropped at the chest on purpose)", () => {
  const trace = { attempts: [{ result: "placed", src: "a", frame: frame(true) }] };
  test("portrait: portraitCut, no frameCut", () => {
    const p = traceProps(trace, "a", "portrait");
    expect(p.portraitCut).toBe(true);
    expect(p.frameCut).toBeUndefined();
    expect(p.cutEdges).toBe(2);
    expect(p.backdrop).toBe("plain");
  });
  test("object: frameCut, no portraitCut", () => {
    const p = traceProps(trace, "a", "object");
    expect(p.frameCut).toBe(true);
    expect(p.portraitCut).toBeUndefined();
  });
});

describe("the outcome's codes", () => {
  test.each([
    ["a head-and-shoulders portrait of a Victorian chimney sweep", null, "portrait"],
    ["a girl in a lab coat holding a test tube", null, "portrait"],
    ["a busy market street in a Kenyan town", null, "scene"],
    ["the Colosseum", "place", "scene"],
    ["a red apple cut in half on a white background", null, "object"],
    ["a scientist", "person", "portrait"],
  ])("%s → %s", (text, named, kind) => {
    expect(pictureKindOf({ text, named })).toBe(kind as never);
  });
  test("a count drawn in code is a drawing", () => {
    expect(pictureKindOf({ text: "24 counters", draw: true })).toBe("drawing");
  });
  test("key stage and subject codes", () => {
    expect(
      ["Reception", "Year 2", "Year 6", "Year 9", "Year 11", "Year 13", "Adults"].map(keyStageOf),
    ).toEqual(["eyfs", "ks1", "ks2", "ks3", "ks4", "ks5", undefined]);
    expect(lessonSubjectOf("Art and design")).toBe("art-and-design");
    expect(lessonSubjectOf("Volcanoes")).toBe("other");
    expect(lessonSubjectOf(undefined)).toBeUndefined();
  });
  test("failedChecks names every gate check a verdict failed", () => {
    const v = {
      pick: null,
      onSubject: false,
      kindMatches: false,
      clear: false,
      fits: false,
      why: null,
      visible: [],
      count: null,
      query: null,
    };
    expect(failedChecks({ mustShow: ["hen"], request: "a hen" }, v)).toEqual([...JUDGE_CHECKS]);
    expect(
      failedChecks(
        { mustShow: [] },
        { ...v, pick: "1", onSubject: true, kindMatches: null, clear: true, fits: true },
      ),
    ).toEqual([]);
  });
});

describe("a failed try says where it failed (production: bare `error`, no detail)", () => {
  test("a storage.put that throws is recorded as stage save, with the S3 code and status", async () => {
    const s3 = Object.assign(
      new Error(
        "Access Denied for https://bucket.s3.amazonaws.com/w/images/g1.png?X-Amz-Signature=abc123&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE",
      ),
      { name: "AccessDenied", $metadata: { httpStatusCode: 403 } },
    );
    const out = await findPicture(
      req,
      bank(async () => {
        // What the worker's `savePicture` throws when `storage.put` fails.
        throw new PictureStageError("save", s3);
      }),
      async () => undefined,
      signal,
      async () => true,
    );
    expect(out.trace.attempts).toEqual([
      {
        result: "error",
        failure: {
          stage: "save",
          error: "AccessDenied",
          code: "AccessDenied",
          status: 403,
          message: "Access Denied for https://bucket.s3.amazonaws.com/w/images/g1.png",
        },
      },
    ]);
    // PostHog: the stage and status; an S3 code is not one of ours, so it stays out.
    expect(traceProps(out.trace, undefined, "object")).toMatchObject({
      failStage: "save",
      failStatus: 403,
      failCode: undefined,
    });
  });

  test("a judge call that throws keeps its provider status and code", async () => {
    const cause = Object.assign(new Error("The model provider request failed."), {
      name: "AI_APICallError",
      statusCode: 429,
      providerErrorCode: "rate_limited",
    });
    let n = 0;
    const out = await findPicture(
      req,
      bank(async () => made(++n)),
      async () => undefined,
      signal,
      async () => {
        throw Object.assign(new Error("Model call failed", { cause }), { name: "AiError" });
      },
    );
    expect(out.trace.attempts[0]?.failure).toMatchObject({
      stage: "judge",
      error: "AiError",
      code: "rate_limited",
      status: 429,
    });
    expect(traceProps(out.trace, undefined, "object")).toMatchObject({
      failStage: "judge",
      failStatus: 429,
      failCode: "rate_limited",
    });
  });

  test("a stock search in the race that finds nothing is recorded as a miss", async () => {
    const out = await findPicture(
      { ...req, stockFirst: true },
      bank(async () => made(1)),
      async () => undefined,
      signal,
      async () => true,
      Date.now,
      undefined,
      1000,
    );
    expect(out.via).toBe("generated");
    expect(out.trace.stock).toBe("miss");
  });

  test("a stock search that throws is a miss with its failure", async () => {
    const out = await findPicture(
      { ...req, route: "real" },
      bank(async () => made(1)),
      async () => {
        throw Object.assign(new Error("stock down"), { status: 503 });
      },
      signal,
    );
    expect(out.trace.stock).toBe("miss");
    expect(out.trace.stockFailure).toMatchObject({ stage: "stock", status: 503 });
  });
});
