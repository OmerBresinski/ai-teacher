import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import * as T from "./worksheet-sheet-text";

/* The prompt text is the prompt engineer's, byte-for-byte: these are the drafts' SHA-256s (ws-prompts-v5). */
const SOURCE_SHA256: Record<keyof typeof T, string> = {
  PRACTICE_SYSTEM: "2c238b520e64b6f81bdd4632aff7fded1ee21add2988990255fd8021279e6416",
  PRACTICE_BAND_Y1_2: "f46a6ccb13b7ec3f764c1fa65aa3415f0037d0c9f355e5c8a3e6cb112be7aab7",
  PRACTICE_BAND_Y3_9: "5da321cdf8f54ef27468424763a38fc9e5f937b7bf239738a958c04031fcad4c",
  PRACTICE_BAND_Y10_11: "949a146c284d27d796b1004ed9b7a2333b8e5fe14466eee28172f590c985e9a3",
  NOTATION_KS1: "80d88fa0ba8d215fe51d69aaf33b104969d861e8fbaf491a9061525a4c86b2cf",
  NOTATION_KS2: "e7d15189902a58960bfbd62d342a736171236bbd19b124037581bb1c51d2281b",
  NOTATION_KS3_4: "47992503d48ff5721a023d02e8520570ce6bc2b48f104a9c2d8ba97eea902fa9",
  EXAM_SYSTEM: "924ac23ae37f3aabeb85e6b37e479ac657ab6448bffcc12de22851d6a12113b2",
};

test.each(Object.entries(SOURCE_SHA256))("%s matches its source draft", (name, sha) => {
  const text = T[name as keyof typeof T];
  expect(createHash("sha256").update(text, "utf8").digest("hex")).toBe(sha);
});
