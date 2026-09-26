/* Proof section: draw the links between the highlighted lines, then replay the sequence once
   when it scrolls into view. The markup is already in its finished state, so without this
   script, or with reduced motion, nothing is hidden. */
(() => {
  const stage = document.querySelector("[data-proof]");
  if (!stage) return;
  const svg = stage.querySelector(".proof-links");
  const anchors = [...stage.querySelectorAll("[data-proof-anchor]")];
  const links = [...stage.querySelectorAll("[data-proof-link]")];
  const items = [...stage.querySelectorAll("[data-proof-step]")];
  const verdict = document.querySelector("[data-proof-verdict]");
  // Below this width the cards stack, and a line would have to cross them.
  const stacked = matchMedia("(max-width: 950px)");

  function draw() {
    svg.style.display = stacked.matches ? "none" : "";
    if (stacked.matches) return;
    const box = stage.getBoundingClientRect();
    links.forEach((path, index) => {
      // The whole highlight's box, so a wrapped line is left from its outer edge, never across it.
      const from = anchors[index].getBoundingClientRect();
      const to = anchors[index + 1].getBoundingClientRect();
      if (!from.width || !to.width) return;
      // The three sit side by side here: leave the end of one highlight, reach the next.
      const x1 = from.right - box.left + 6;
      const y1 = from.top + from.height / 2 - box.top;
      const x2 = to.left - box.left - 6;
      const y2 = to.top + to.height / 2 - box.top;
      const mid = (x1 + x2) / 2;
      const d = `M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`;
      path.setAttribute("d", d);
      const length = path.getTotalLength();
      path.dataset.length = String(length);
      // Before the replay reaches a link it stays masked, even across a resize.
      if (path.dataset.pending) {
        path.style.strokeDasharray = `${length} ${length}`;
        path.style.strokeDashoffset = String(length);
      }
    });
  }

  draw();
  addEventListener("resize", draw);
  document.fonts?.ready.then(draw);

  if (matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window))
    return;

  // Hide a path by masking it with its own length, then reveal it by animating the offset.
  const hideLink = (path) => {
    path.dataset.pending = "true";
    const length = Number(path.dataset.length || 0);
    path.style.strokeDasharray = `${length} ${length}`;
    path.style.strokeDashoffset = String(length);
  };
  const showLink = (path) => {
    delete path.dataset.pending;
    path.style.strokeDashoffset = "0";
  };
  const cheer = (item) => {
    const actor = item.querySelector(".proof-character");
    if (!actor) return;
    actor.classList.remove("is-cheering");
    void actor.offsetWidth;
    actor.classList.add("is-cheering");
  };

  stage.classList.add("proof-armed");
  for (const path of links) hideLink(path);

  const steps = [
    [0, () => items[0].classList.add("is-in")],
    [150, () => items[1].classList.add("is-in")],
    [300, () => items[2].classList.add("is-in")],
    [900, () => anchors[0].classList.add("is-on")],
    [1300, () => cheer(items[0])],
    [1500, () => showLink(links[0])],
    [2300, () => anchors[1].classList.add("is-on")],
    [2500, () => cheer(items[1])],
    [2800, () => showLink(links[1])],
    [3600, () => anchors[2].classList.add("is-on")],
    [3800, () => cheer(items[2])],
    [4300, () => verdict?.classList.add("is-in")],
  ];

  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      for (const [delay, run] of steps) setTimeout(run, delay);
    },
    { threshold: 0.45 },
  );
  observer.observe(stage);
})();
