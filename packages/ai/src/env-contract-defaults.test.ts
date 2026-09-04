import { describe, expect, test } from "bun:test";
import { ENV_CONTRACT } from "../../../infra/env.contract";
import { DEFAULT_MODEL_IDS, DEFAULT_REGION } from "./create-ai";

function contractValue(name: string): { local: string | null; railwayValue?: string } {
  const variable = ENV_CONTRACT.find((entry) => entry.name === name);
  if (!variable) throw new Error(`Missing ${name} from env contract`);
  return variable;
}

describe("AI environment contract defaults", () => {
  test("match @tj/ai defaults", () => {
    expect(contractValue("AWS_REGION")).toMatchObject({
      local: DEFAULT_REGION,
      railwayValue: DEFAULT_REGION,
    });
    expect(contractValue("AI_MODEL_FRONTIER")).toMatchObject({
      local: DEFAULT_MODEL_IDS.frontier,
      railwayValue: DEFAULT_MODEL_IDS.frontier,
    });
    expect(contractValue("AI_MODEL_STANDARD")).toMatchObject({
      local: DEFAULT_MODEL_IDS.standard,
      railwayValue: DEFAULT_MODEL_IDS.standard,
    });
    expect(contractValue("AI_MODEL_SMALL")).toMatchObject({
      local: DEFAULT_MODEL_IDS.small,
      railwayValue: DEFAULT_MODEL_IDS.small,
    });
  });
});
