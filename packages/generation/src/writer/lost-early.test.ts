import { describe, expect, test } from "bun:test";
import { recordedVisuals, replayRun, replayServices } from "./replay-fixture";

// TEACH-110 part h: on the paid run e2e-speed-1 the lostPic round started only after the repairs
// (5.9 s) and the notes waited for it (36.3 s). The r2 fixture's slide 6 lost its two-animal
// picture and was split (its log's `lost-picture` line).
describe("lostPic starts at slot failure and notes run beside it", () => {
  const B = "y1-science-animals-young-r2";
  const run = async () => {
    const order: string[] = [];
    const services = replayServices(B);
    const rv = recordedVisuals(B);
    await replayRun(B, {
      visual: rv,
      services: {
        ...services,
        chat: (r) => {
          order.push(`chat:${r.name}`);
          return services.chat(r);
        },
      },
      hooks: {
        placeEarly: (i) => {
          order.push(`early:${i}`);
        },
        placeMore: async (i) => {
          order.push(`more:${i}`);
          await rv.placeMore(i);
          await new Promise((r) => setTimeout(r, 20));
          order.push(`more-done:${i}`);
        },
      },
    });
    return order;
  };
  test("the split's panels start before the first repair call", async () => {
    const order = await run();
    const early = order.indexOf("early:5");
    expect(early).toBeGreaterThanOrEqual(0);
    const repair = order.indexOf("chat:slide");
    expect(repair).toBeGreaterThan(early);
  });
  test("every notes call starts before the lostPic round ends (none written again after)", async () => {
    const order = await run();
    const end = order.indexOf("more-done:5");
    expect(end).toBeGreaterThan(0);
    expect(order.includes("chat:notes")).toBe(true);
    expect(order.slice(end).includes("chat:notes")).toBe(false);
  });
});
