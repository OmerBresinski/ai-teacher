// Plan's existing entrance (v6b, from below) on the planning stage. It plays with its own engine and
// keys on a layer placed exactly over the rig's rest drawing (rig.restBox), then hands over: the
// entrance ends on the rest artwork, the rig shows Plan and the layer goes. Never re-timed here.
import { PLAN_SPECS } from "./plan-entry.js";

/**
 * Play Plan entering from below inside `stage` (the region drawings may use), over `box` (page px
 * of the rest artwork). Calls `onEnd` once the rest artwork is on screen.
 */
export function playPlanEntrance({ stage, box, onEnd }) {
  const layer = document.createElement("div");
  layer.className = "cast-entrance";
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText = `position:fixed;left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px;z-index:82;pointer-events:none`;
  const actor = document.createElement("div");
  actor.className = "actor";
  actor.dataset.from = "below";
  actor.innerHTML = window.characters.support;
  const shadow = document.createElement("div");
  shadow.className = "arrival-shadow";
  // The rig's own ground shadow, exactly: at rest the two are the same element's twin.
  if (box.shadow) {
    const s = box.shadow;
    shadow.style.cssText = `left:${s.left - box.left}px;top:${s.top - box.top}px;width:${s.width}px;height:${s.height}px;background:rgba(41,59,50,.12);filter:none`;
  }
  layer.append(shadow, actor);
  document.body.append(layer);
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    // The rig draws Plan synchronously in onEnd; the layer goes in the same task, so no painted
    // frame has both drawings or neither.
    onEnd?.();
    layer.remove();
  };
  const plan = window.SmoothPlan.start({
    actor,
    specs: PLAN_SPECS,
    region: () => stage.getBoundingClientRect(),
    section: stage,
    shadow,
    onEnd: finish,
  });
  plan.begin("below");
  if (!plan.running) finish();
  return { cancel: finish };
}
