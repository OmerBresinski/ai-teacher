import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { newId, type WorkspaceId } from "@tj/domain";
import { sql } from "drizzle-orm";
import { createTestUserWithWorkspace, withTestDb } from "./testing";
import {
  applyCountryHint,
  getWorkspaceCountry,
  getWorkspaceSettings,
  setWorkspaceCountry,
} from "./workspace-settings";

const t = await withTestDb();
const describeDb = t.ok ? describe : describe.skip;
if (!t.ok) console.warn(`skipping workspace settings tests: ${t.reason}`);

describeDb("workspace country (TEACH-33 part b)", () => {
  if (!t.ok) return;
  const { unsafeDb, truncateTenantTables, close } = t.db;
  afterAll(() => close());

  const wsA = newId<WorkspaceId>();
  const wsB = newId<WorkspaceId>();

  beforeEach(async () => {
    await truncateTenantTables();
    await createTestUserWithWorkspace(unsafeDb, { workspaceId: wsA, workspaceName: "A" });
    await createTestUserWithWorkspace(unsafeDb, { workspaceId: wsB, workspaceName: "B" });
  });

  test("a new Workspace is unset, which reads as England", async () => {
    expect(await getWorkspaceSettings(unsafeDb, wsA)).toEqual({
      country: "england",
      chosen: false,
    });
  });

  test("the sign-up hint sets an unset country once and never overrides one", async () => {
    expect(await applyCountryHint(unsafeDb, wsA, "india")).toBe("india");
    expect(await applyCountryHint(unsafeDb, wsA, "usa")).toBe("india");
    await setWorkspaceCountry(unsafeDb, wsB, "wales");
    expect(await applyCountryHint(unsafeDb, wsB, "india")).toBe("wales");
    expect(await getWorkspaceSettings(unsafeDb, wsA)).toEqual({ country: "india", chosen: true });
  });

  test("set then read; the other Workspace is untouched", async () => {
    await setWorkspaceCountry(unsafeDb, wsA, "india");
    expect(await getWorkspaceCountry(unsafeDb, wsA)).toBe("india");
    expect(await getWorkspaceCountry(unsafeDb, wsB)).toBe("england");
  });

  test("an unknown stored value or a missing row reads as England", async () => {
    await unsafeDb.execute(sql`update workspaces set country = 'atlantis' where id = ${wsA}`);
    expect(await getWorkspaceCountry(unsafeDb, wsA)).toBe("england");
    expect(await getWorkspaceCountry(unsafeDb, newId<WorkspaceId>())).toBe("england");
  });
});
