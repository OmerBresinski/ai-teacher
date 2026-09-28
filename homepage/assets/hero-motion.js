/* Quiet, scoped life for the approved hero poses. The loading cast is untouched.
   Hover reactions live in motion/hero-hover.js, loaded after first paint (or at once when a pointer
   comes near the characters); while a reaction plays it owns that character and adds this idle sway
   on top, so the handback is seamless. */
(() => {
  const script = document.currentScript;
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
      glasses: svg.querySelector(".glasses"),
    };
  });
  // The idle sway and blink at this moment, as offsets from the pose (all zero at rest).
  function sway(actor, resting) {
    if (resting) return { lift: 0, lean: 0, arm: 0, blink: 1 };
    const { index } = actor;
    const phase = (elapsed * Math.PI * 2) / [4.7, 5.4, 6.1, 6.8][index] + index * 1.7;
    const blinkTime = (elapsed + index * 1.3) % (5.2 + index * 0.8);
    return {
      lift: Math.sin(phase * 1.17) * 1.25,
      lean: Math.sin(phase) * 0.85,
      arm: Math.sin(phase * 0.7) * 0.65,
      blink: blinkTime > 0.18 ? 1 : Math.abs(blinkTime - 0.09) / 0.09,
    };
  }
  function paint(actor, resting) {
    if (actor.owner) return;
    const { pose } = actor;
    const idle = sway(actor, resting);
    const lift = idle.lift;
    const angle = pose.angle + idle.lean;
    const arm = idle.arm;
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
    actor.glasses?.setAttribute("transform", "translate(0 0)");
    for (const eye of actor.eyes)
      eye.element.setAttribute("ry", Math.max(0.2, eye.radius * idle.blink));
  }
  const blocked = () => preference.matches || document.hidden;
  const life = { actors, sway, paint, blocked, onReset: null };
  function reset() {
    life.onReset?.();
    for (const actor of actors) {
      paint(actor, true);
    }
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const actor = actors.find((item) => item.host === entry.target);
        actor.visible = entry.isIntersecting && entry.intersectionRatio >= 0.25;
        if (!actor.visible) {
          paint(actor, true);
        }
      }
    },
    { threshold: [0, 0.25] },
  );
  for (const actor of actors) {
    observer.observe(actor.host);
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
  // Hover reactions and the hover highlight: fetched once the page is idle, or at once when a pointer nears the characters.
  window.HeroLife = life;
  const stage = hosts[0].parentElement;
  let loading = false;
  function load() {
    if (loading || !script) return;
    loading = true;
    for (const name of ["hero-hover", "hover-contour"]) {
      const tag = document.createElement("script");
      tag.src = script.src.replace(/assets\/hero-motion\.js.*$/, `motion/${name}.js`);
      tag.async = true;
      document.head.append(tag);
    }
  }
  stage.addEventListener("pointerover", load, { once: true, passive: true });
  stage.addEventListener("pointerdown", load, { once: true, passive: true });
  const idle = window.requestIdleCallback || ((f) => setTimeout(f, 1200));
  if (document.readyState === "complete") idle(load, { timeout: 3000 });
  else window.addEventListener("load", () => idle(load, { timeout: 3000 }), { once: true });
})();
