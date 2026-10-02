// The cast's existing entrances in the creation flow. Each plays with its own engine and keys on a
// layer placed exactly over the rig's rest drawing (rig.restBox), then hands over: the entrance ends
// on the rest artwork, the rig shows the character and the layer goes. Pages pick a direction; they
// never copy or re-time the clips.
import { PLAN_SPECS } from "./plan-entry.js";
import { SLIDES_SPECS } from "./slides-entry.js";

/**
 * Play `who` ("plan" | "slides") entering from `from` (left | right | above | below) inside `stage`
 * (the region drawings may use), over `box` (page px of the rest artwork). `shake` is the copy the
 * Slides landing shakes. Calls `onEnd` once the rest artwork is on screen. `follow` (optional)
 * returns the rest artwork's box each frame, so the layer stays on the rig while the stage moves
 * (the generating companion flies to its slot when the first slide lands).
 */
export function playEntrance(who, { stage, box, from = "below", shake, follow, onEnd }) {
  const layer = document.createElement("div");
  layer.className = "cast-entrance";
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText = `position:fixed;left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px;z-index:82;pointer-events:none`;
  let tracking = 0;
  const track = () => {
    const b = follow?.();
    if (b) {
      layer.style.transformOrigin = "0 0";
      layer.style.transform = `translate(${b.left - box.left}px, ${b.top - box.top}px) scale(${b.width / box.width})`;
    }
    tracking = requestAnimationFrame(track);
  };
  if (follow) tracking = requestAnimationFrame(track);
  const actor = document.createElement("div");
  actor.className = "actor";
  actor.dataset.from = from;
  actor.innerHTML = window.characters[who === "plan" ? "support" : "slides"];
  const shadow = document.createElement("div");
  shadow.className = "arrival-shadow";
  // The rig's own ground shadow, exactly: at rest the two are the same element's twin.
  if (box.shadow) {
    const s = box.shadow;
    shadow.style.cssText = `left:${s.left - box.left}px;top:${s.top - box.top}px;width:${s.width}px;height:${s.height}px;background:rgba(41,59,50,.12);filter:none`;
  }
  layer.append(shadow, actor);
  document.body.append(layer);
  const region = () => stage.getBoundingClientRect();
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    cancelAnimationFrame(tracking);
    // The rig draws its character synchronously in onEnd; the layer goes in the same task, so no
    // painted frame has both drawings or neither.
    onEnd?.();
    layer.remove();
  };
  if (who === "plan") {
    const plan = window.SmoothPlan.start({
      actor,
      specs: PLAN_SPECS,
      region,
      section: stage,
      shadow,
      onEnd: finish,
    });
    plan.begin(from);
    if (!plan.running) finish();
  } else {
    const a = actor.getBoundingClientRect(),
      r = region(),
      k = a.width / 300;
    const s = SLIDES_SPECS[from] || SLIDES_SPECS.right;
    const spec =
      typeof s === "function" ? s({ ceil: (r.top - a.top) / k, left: (r.left - a.left) / k }) : s;
    const smooth = window.SmoothSlides.start({
      actor,
      spec,
      clips: window.CLIPS,
      region,
      side: shake ?? stage,
      section: stage,
      shadow,
    });
    smooth.begin(spec);
    setTimeout(finish, spec.duration + 20);
  }
  return { cancel: finish };
}
