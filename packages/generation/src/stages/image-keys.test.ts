import { describe, expect, test } from "bun:test";
import { imageKeys } from "./illustrate";

const commons = (file: string, tiny = "https://upload.wikimedia.org/x.jpg") => ({
  pageUrl: `https://commons.wikimedia.org/wiki/File:${file}`,
  src: { large: "", medium: "", tiny },
});
const shared = (a: string[], b: string[]) => a.filter((k) => b.includes(k));

describe("one picture from two Commons files is one picture (picq, greatfire 26 Oct)", () => {
  test("the greatfire painting and its Google Art Project copy share a key", () => {
    const a = imageKeys(commons("The_Great_Fire_of_London,_with_Ludgate_and_Old_St._Paul%27s.JPG"));
    const b = imageKeys(
      commons(
        "The_Great_Fire_of_London,_with_Ludgate_and_Old_St._Paul%27s_-_Google_Art_Project.jpg",
      ),
    );
    expect(shared(a, b).length).toBe(1);
    expect(shared(a, b)[0]).toStartWith("title:");
  });
  test("a cropped copy shares a key; two different photos of one monument do not", () => {
    expect(
      shared(
        imageKeys(commons("Great_Fire_1666.jpg")),
        imageKeys(commons("Great_Fire_1666_(cropped).jpg")),
      ).length,
    ).toBe(1);
    expect(
      shared(
        imageKeys(commons("Monument_to_the_Great_Fire_of_London_2.jpg")),
        imageKeys(commons("Monument_to_the_Great_Fire_of_London_2026-09-22.jpg")),
      ),
    ).toEqual([]);
  });
  test("a Pexels photo is known by its page only", () => {
    expect(imageKeys({ pageUrl: "https://www.pexels.com/photo/9/" })).toEqual([
      "https://www.pexels.com/photo/9/",
    ]);
  });
});
