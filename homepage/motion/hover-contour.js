/* Hover highlight (Contour v2, motion/hover-contour.css) for every hoverable character on the
   homepage: the four hero characters, the How it works Slides and the closing Check. It switches on
   with the character's own pointerenter (so it starts with the reaction) and off on leave; a touch
   or pen tap shows it for 900 ms. Colour only, so it also shows under reduced motion. Loaded after
   first paint by assets/hero-motion.js; nothing runs at rest. */
(() => {
  // [body tint, deeper line colour], each from the character's own artwork
  const SLIDES = ["#f5c054", "#e88f52"];
  const CHECK = ["#efa991", "#d6846c"];
  const TINTS = {
    slides: SLIDES,
    support: ["#d6e2bd", "#80956f"],
    activity: ["#ccdceb", "#7fa3c9"],
    answers: CHECK,
  };
  const targets = [
    ...[...document.querySelectorAll("[data-hero-actor]")].map((el) => [
      el,
      TINTS[el.dataset.heroActor],
    ]),
    ...[...document.querySelectorAll("[data-hiw-actor]")].map((el) => [el, SLIDES]),
    ...[...document.querySelectorAll("[data-closing-check]")].map((el) => [el, CHECK]),
  ].filter(([, tint]) => tint);
  if (!targets.length) return;
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = document.currentScript.src.replace(/hover-contour\.js.*$/, "hover-contour.css");
  document.head.append(css);
  for (const [host, [tint, deep]] of targets) {
    host.style.setProperty("--ha-tint", tint);
    host.style.setProperty("--ha-deep", deep);
    host.classList.add("ha");
    let fade = 0;
    let tap = 0;
    const on = () => {
      clearTimeout(fade);
      host.classList.remove("is-off");
      host.classList.add("is-on");
    };
    const off = () => {
      if (!host.classList.contains("is-on")) return;
      host.classList.replace("is-on", "is-off");
      clearTimeout(fade);
      fade = setTimeout(() => host.classList.remove("is-off"), 300);
    };
    host.addEventListener("pointerenter", (e) => e.pointerType === "mouse" && on());
    host.addEventListener("pointerleave", (e) => e.pointerType === "mouse" && off());
    host.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse") return;
      on();
      clearTimeout(tap);
      tap = setTimeout(() => !host.matches(":hover") && off(), 900);
    });
    if (host.matches(":hover")) on();
  }
})();
