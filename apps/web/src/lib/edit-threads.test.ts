import { afterEach, expect, test } from "bun:test";
import { EDIT_THREAD_PREFIX as EDITOR_PREFIX } from "@tj/editor/starter";
import { clearEditThreads, EDIT_THREAD_PREFIX } from "./edit-threads";

afterEach(() => window.localStorage.clear());

test("the prefix is the editor's, and sign-out clears every thread and nothing else", () => {
  expect(EDIT_THREAD_PREFIX).toBe(EDITOR_PREFIX);
  window.localStorage.setItem(`${EDIT_THREAD_PREFIX}user-a.lesson-1`, "[]");
  window.localStorage.setItem(`${EDIT_THREAD_PREFIX}lesson-2`, "[]");
  window.localStorage.setItem("tj-theme", "light");
  clearEditThreads();
  expect(window.localStorage.getItem(`${EDIT_THREAD_PREFIX}user-a.lesson-1`)).toBeNull();
  expect(window.localStorage.getItem(`${EDIT_THREAD_PREFIX}lesson-2`)).toBeNull();
  expect(window.localStorage.getItem("tj-theme")).toBe("light");
});
