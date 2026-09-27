/* Finished markup is the fallback; motion is a scroll-triggered enhancement. */
(() => {
  const stage = document.querySelector("[data-proof]");
  if (!stage || !("IntersectionObserver" in window)) return;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let visible = false;
  function update() {
    stage.classList.toggle("materials-paused", !visible || document.hidden);
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
  reduced.addEventListener("change", update);
  document.addEventListener("visibilitychange", update);
})();
