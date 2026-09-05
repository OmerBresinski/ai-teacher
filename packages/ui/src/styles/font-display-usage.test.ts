import { describe, expect, it } from "bun:test";

const componentDirectory = new URL("../components/", import.meta.url);

describe("font-display usage", () => {
  it("is limited to the sanctioned heading components", async () => {
    const files = new Bun.Glob("*.tsx");
    const users: string[] = [];

    for await (const file of files.scan({ cwd: componentDirectory.pathname })) {
      if (file.endsWith(".test.tsx")) continue;
      if ((await Bun.file(new URL(file, componentDirectory)).text()).includes("font-display")) {
        users.push(file);
      }
    }

    expect(users.toSorted()).toEqual(["alert-dialog.tsx", "dialog.tsx", "display.tsx"]);
  });
});
