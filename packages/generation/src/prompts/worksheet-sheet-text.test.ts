import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import * as T from "./worksheet-sheet-text";

/* The prompt text is the prompt engineer's, byte-for-byte: these are the drafts' SHA-256s. */
const SOURCE_SHA256: Record<keyof typeof T, string> = {
  PRACTICE_SYSTEM: "9ae7ddfbd622b8aafd89728cfbf53bb1e595f9762b8426164fb3891ab6ecab9f",
  PRACTICE_BAND_Y1_2: "6ace249f9cc796c985b35806673e94674cdd616a7d7efb97cf93cacde95d967c",
  PRACTICE_BAND_Y3_9: "2f89cbcd00cac0375cd8eb26997ae0c31f03a6044146dc1339f6c6d14c17ebf5",
  PRACTICE_BAND_Y10_11: "045c08acb9de0c27ced4d3bab803eeb7a38321895ca74c90b6aa7749b99a7de1",
  NOTATION_KS1: "80d88fa0ba8d215fe51d69aaf33b104969d861e8fbaf491a9061525a4c86b2cf",
  NOTATION_KS2: "e7d15189902a58960bfbd62d342a736171236bbd19b124037581bb1c51d2281b",
  NOTATION_KS3_4: "47992503d48ff5721a023d02e8520570ce6bc2b48f104a9c2d8ba97eea902fa9",
  EXAM_SYSTEM: "924ac23ae37f3aabeb85e6b37e479ac657ab6448bffcc12de22851d6a12113b2",
};

test.each(Object.entries(SOURCE_SHA256))("%s matches its source draft", (name, sha) => {
  const text = T[name as keyof typeof T];
  expect(createHash("sha256").update(text, "utf8").digest("hex")).toBe(sha);
});
