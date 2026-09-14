/* Quiet, scoped life for the approved hero poses. The loading cast is untouched. */
(() => {
  const hosts = [...document.querySelectorAll("[data-hero-actor]")];
  if (!hosts.length || !window.gsap) return;
  const preference = matchMedia("(prefers-reduced-motion: reduce)");
  let elapsed = 0;
  const actors = hosts.map((host, index) => {
    const svg = host.querySelector("svg");
    const eyes = [...svg.querySelectorAll(".eye")].map((eye) => {
      const ellipse = document.createElementNS("http://www.w3.org/2000/svg", "ellipse");
      for (const attribute of eye.attributes) ellipse.setAttribute(attribute.name, attribute.value);
      const radius = Number(eye.getAttribute("r"));
      ellipse.setAttribute("rx", radius);
      ellipse.setAttribute("ry", radius);
      eye.replaceWith(ellipse);
      return { element: ellipse, radius };
    });
    return {
      host,
      index,
      pose: JSON.parse(host.dataset.heroPose),
      body: svg.querySelector(".body"),
      legs: svg.querySelector(".hero-legs"),
      left: svg.querySelector(".arm-left"),
      right: svg.querySelector(".arm-right"),
      eyes,
      visible: false,
      gesture: 0,
      leftGesture: 0,
      rightGesture: 0,
      lean: 0,
      rise: 0,
      glassesLift: 0,
      glasses: svg.querySelector(".glasses"),
    };
  });
  function paint(actor, resting) {
    const { pose, index } = actor;
    const phase = (elapsed * Math.PI * 2) / [4.7, 5.4, 6.1, 6.8][index] + index * 1.7;
    const lift = resting ? 0 : Math.sin(phase * 1.17) * 1.25 + actor.rise;
    const angle = pose.angle + (resting ? 0 : Math.sin(phase) * 0.85 + actor.lean);
    const arm = resting ? 0 : Math.sin(phase * 0.7) * 0.65 + actor.gesture;
    actor.body.setAttribute(
      "transform",
      `translate(0 ${lift}) translate(150 235) rotate(${angle}) translate(-150 -235)`,
    );
    const rad = (angle * Math.PI) / 180;
    actor.legs.setAttribute(
      "d",
      pose.feet
        .map(([hx, hy, ax, ay, tx, ty]) => {
          const x = 150 + (hx - 150) * Math.cos(rad) - (hy - 235) * Math.sin(rad);
          const y = 235 + lift + (hx - 150) * Math.sin(rad) + (hy - 235) * Math.cos(rad);
          return `M${x} ${y} Q${(x + ax) / 2} ${(y + ay) / 2} ${ax} ${ay} L${tx} ${ty}`;
        })
        .join(" "),
    );
    actor.left.setAttribute(
      "transform",
      `rotate(${arm * 0.5 + (resting ? 0 : actor.leftGesture)} ${pose.pivots[0].join(" ")})`,
    );
    actor.right.setAttribute(
      "transform",
      `rotate(${-arm + (resting ? 0 : actor.rightGesture)} ${pose.pivots[1].join(" ")})`,
    );
    actor.glasses?.setAttribute("transform", `translate(0 ${resting ? 0 : actor.glassesLift})`);
    const blinkTime = (elapsed + index * 1.3) % (5.2 + index * 0.8);
    const blink = resting || blinkTime > 0.18 ? 1 : Math.abs(blinkTime - 0.09) / 0.09;
    for (const eye of actor.eyes) eye.element.setAttribute("ry", Math.max(0.2, eye.radius * blink));
  }
  const blocked = () => preference.matches || document.hidden;
  function reset() {
    for (const actor of actors) {
      gsap.killTweensOf(actor);
      actor.gesture =
        actor.leftGesture =
        actor.rightGesture =
        actor.lean =
        actor.rise =
        actor.glassesLift =
          0;
      paint(actor, true);
    }
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const actor = actors.find((item) => item.host === entry.target);
        actor.visible = entry.isIntersecting && entry.intersectionRatio >= 0.25;
        if (!actor.visible) {
          gsap.killTweensOf(actor);
          actor.gesture =
            actor.leftGesture =
            actor.rightGesture =
            actor.lean =
            actor.rise =
            actor.glassesLift =
              0;
          paint(actor, true);
        }
      }
    },
    { threshold: [0, 0.25] },
  );
  for (const actor of actors) {
    observer.observe(actor.host);
    actor.host.addEventListener("pointerenter", (event) => {
      if (event.pointerType === "touch" || blocked() || !actor.visible) return;
      gsap.killTweensOf(actor);
      const t = gsap.timeline();
      const to = (values, at, duration) =>
        t.to(actor, { ...values, duration, ease: "sine.inOut" }, at);
      const kind = actor.host.dataset.heroActor;
      if (kind === "slides") {
        to({ lean: -3, rise: -1.5, rightGesture: -22, leftGesture: 4 }, 0, 0.45);
        to({ rightGesture: -8 }, 0.45, 0.18);
        to({ rightGesture: -20 }, 0.63, 0.2);
        to({ rightGesture: -12 }, 0.83, 0.2);
      } else if (kind === "activity") {
        to({ rise: 2, lean: -1 }, 0, 0.14);
        to({ rise: -3, lean: 2, rightGesture: 20, leftGesture: 6 }, 0.14, 0.42);
        to({ rightGesture: 15 }, 0.56, 0.35);
      } else if (kind === "support") {
        to({ rise: 1.5, lean: -1 }, 0, 0.27);
        to({ rise: -1, leftGesture: 18, rightGesture: -18 }, 0.27, 0.65);
      } else {
        to({ lean: 2.8, rise: 1 }, 0, 0.4);
        to({ glassesLift: -3.2, rightGesture: -9 }, 0.25, 0.4);
        to({ rise: 2.5, lean: 1.8 }, 0.7, 0.22);
      }
      to({ leftGesture: 0, rightGesture: 0, lean: 0, rise: 0, glassesLift: 0 }, 1.05, 0.8);
    });
  }
  function tick(_time, delta) {
    if (blocked() || !actors.some((actor) => actor.visible)) return;
    elapsed += Math.min(delta / 1000, 0.05);
    for (const actor of actors) if (actor.visible) paint(actor, false);
  }
  preference.addEventListener("change", reset);
  document.addEventListener("visibilitychange", reset);
  window.addEventListener("pagehide", () => {
    gsap.ticker.remove(tick);
    observer.disconnect();
    reset();
  });
  window.addEventListener("pageshow", () => {
    actors.forEach((actor) => {
      observer.observe(actor.host);
    });
    gsap.ticker.add(tick);
    reset();
  });
  reset();
  gsap.ticker.add(tick);
})();
