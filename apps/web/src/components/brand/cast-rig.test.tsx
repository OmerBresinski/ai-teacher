import { describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";
import { CAST_ARTWORK } from "./cast-artwork";
import { type CastKind, createCast, legsPath, mouthPath, POSES } from "./cast-rig";

const KINDS = Object.keys(POSES) as CastKind[];

function renderCast() {
  const { container } = render(
    <div>
      {KINDS.map((kind) => (
        <div key={kind} data-cast={kind}>
          {CAST_ARTWORK[kind]}
        </div>
      ))}
    </div>,
  );
  return [...container.querySelectorAll<HTMLElement>("[data-cast]")];
}

describe("cast rig", () => {
  it("at rest, draws each character's legs exactly as the homepage artwork does", () => {
    const hosts = renderCast();
    for (const host of hosts) {
      const kind = host.dataset.cast as CastKind;
      const drawn = host.querySelector(".hero-legs")?.getAttribute("d");
      expect(legsPath(POSES[kind], POSES[kind].angle, 0)).toBe(drawn ?? "");
    }
  });

  it("a hop lifts hips, ankles and toes together", () => {
    const pose = POSES.slides;
    const numbers = (d: string) => d.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
    const rest = numbers(legsPath(pose, 0, 0));
    const hop = numbers(legsPath(pose, 0, 0, -10));
    // Every y (odd positions) moves up by 10; every x stays.
    for (const [i, value] of rest.entries()) {
      expect(hop[i]).toBeCloseTo(i % 2 ? value - 10 : value, 6);
    }
  });

  it("a smile deepens the mouth's curve and a worry flattens it", () => {
    const face = POSES.support.face;
    const controlY = (d: string) => Number(d.split("Q")[1]?.trim().split(" ")[1]);
    expect(mouthPath(face, 0)).toBe("M130 153 Q144 164 158 152");
    expect(controlY(mouthPath(face, 1))).toBeGreaterThan(controlY(mouthPath(face, 0)));
    expect(controlY(mouthPath(face, -0.5))).toBeLessThan(controlY(mouthPath(face, 0)));
  });

  it("with motion off, only the faces follow the mood and the pose never moves", () => {
    const hosts = renderCast();
    const stage = document.createElement("div");
    const cast = createCast(hosts, null);
    const slides = hosts.find((host) => host.dataset.cast === "slides");
    const body = () => slides?.querySelector(".body")?.getAttribute("transform");
    const mouth = () => slides?.querySelector(".mouth")?.getAttribute("d");

    cast.enter(stage, true);
    expect(stage.dataset.castStage).toBe("still");
    cast.setMood("sent", null);
    const pose = body();
    expect(mouth()).toBe(mouthPath(POSES.slides.face, 0.8));
    cast.setMood("error", null);
    expect(mouth()).toBe(mouthPath(POSES.slides.face, -0.35));
    expect(body()).toBe(pose);
    cast.destroy();
    expect(mouth()).toBe(mouthPath(POSES.slides.face, 0));
  });
});
