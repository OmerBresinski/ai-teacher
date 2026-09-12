/* Quiet, scoped life for the approved hero poses. The loading cast is untouched. */
(() => {
  const hosts = [...document.querySelectorAll("[data-hero-actor]")];
  if (!hosts.length || !window.gsap) return;
  const preference = matchMedia("(prefers-reduced-motion: reduce)");
  const pause = document.querySelector("[data-pause-hero]");
  const sharedPause = document.querySelector("[data-pause-cast]");
  let paused = sharedPause?.getAttribute("aria-pressed") === "true";
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
    };
  });
  function paint(actor, resting) {
    const { pose, index } = actor;
    const phase = (elapsed * Math.PI * 2) / [4.7, 5.4, 6.1, 6.8][index] + index * 1.7;
    const lift = resting ? 0 : Math.sin(phase * 1.17) * 0.65;
    const angle = pose.angle + (resting ? 0 : Math.sin(phase) * 0.45);
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
    actor.left.setAttribute("transform", `rotate(${arm * 0.5} ${pose.pivots[0].join(" ")})`);
    actor.right.setAttribute("transform", `rotate(${-arm} ${pose.pivots[1].join(" ")})`);
    const blinkTime = (elapsed + index * 1.3) % (5.2 + index * 0.8);
    const blink = resting || blinkTime > 0.18 ? 1 : Math.abs(blinkTime - 0.09) / 0.09;
    for (const eye of actor.eyes) eye.element.setAttribute("ry", Math.max(0.2, eye.radius * blink));
  }
  const blocked = () => paused || preference.matches || document.hidden;
  function reset() {
    for (const actor of actors) {
      gsap.killTweensOf(actor);
      actor.gesture = 0;
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
          actor.gesture = 0;
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
      gsap.to(actor, {
        gesture: 2,
        duration: 0.6,
        yoyo: true,
        repeat: 1,
        ease: "sine.inOut",
        overwrite: true,
      });
    });
  }
  function tick(_time, delta) {
    if (blocked() || !actors.some((actor) => actor.visible)) return;
    elapsed += Math.min(delta / 1000, 0.05);
    for (const actor of actors) if (actor.visible) paint(actor, false);
  }
  function reflectPause() {
    paused = sharedPause?.getAttribute("aria-pressed") === "true";
    pause?.setAttribute("aria-pressed", String(paused));
    if (pause) pause.textContent = paused ? "Resume motion" : "Pause motion";
    reset();
  }
  sharedPause?.addEventListener("click", reflectPause);
  pause?.addEventListener("click", () => sharedPause?.click());
  if (pause && sharedPause) pause.hidden = false;
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
