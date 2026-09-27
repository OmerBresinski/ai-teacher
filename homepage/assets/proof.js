/* Finished markup is the fallback; motion is a scroll-triggered enhancement. */
(() => {
  const stage = document.querySelector("[data-proof]");
  const toggle = document.querySelector("[data-proof-pause]");
  if (!stage || !toggle || !("IntersectionObserver" in window)) return;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let visible = false;
  let paused = false;
  function update() {
    toggle.hidden = reduced.matches;
    stage.classList.toggle("materials-paused", paused || !visible || document.hidden);
    if (visible && !reduced.matches) stage.classList.add("materials-started");
  }
  const observer = new IntersectionObserver(
    (entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
      update();
    },
    { threshold: 0.15 },
  );
  observer.observe(stage);
  toggle.addEventListener("click", () => {
    paused = !paused;
    toggle.textContent = paused ? "Resume motion" : "Pause motion";
    update();
  });
  reduced.addEventListener("change", update);
  document.addEventListener("visibilitychange", update);
})();
