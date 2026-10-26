import { expect, test } from "bun:test";
import { objectivesRoomTable } from "../../scripts/objectives-room";
import room from "./objectives-room.gen.json" with { type: "json" };

// TEACH-110 part an: the pupil lines' room is measured on the objectives slide as it is laid now
// (`bun scripts/objectives-room.ts` regenerates it after a layout change).
test("objectives-room.gen.json is the room the objectives slide measures today", () => {
  expect(objectivesRoomTable()).toEqual(room);
});
