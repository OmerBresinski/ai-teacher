import { expect, test } from "bun:test";
import { scan } from "../scripts/catalogue";
import { EVENT_KEYS } from "./catalogue.gen";

test("catalogue.gen.ts matches the pipeline's ev log lines (re-run scripts/catalogue.ts)", () => {
  expect(EVENT_KEYS).toEqual(scan());
});
