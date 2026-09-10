(() => {
  const root = document.querySelector("[data-example]");
  if (!root) return;
  const tabs = [...root.querySelectorAll("[data-tab]")];
  const panels = [...root.querySelectorAll(".ex-panel")];
  let activeSlide = 0;
  const slides = [...root.querySelectorAll("[data-slide]")];
  const previous = root.querySelector("[data-slide-prev]");
  const next = root.querySelector("[data-slide-next]");
  function showSlide(index) {
    activeSlide = Math.max(0, Math.min(index, slides.length - 1));
    slides.forEach((slide, i) => {
      slide.hidden = i !== activeSlide;
    });
    root.querySelector("[data-slide-count]").textContent = `${activeSlide + 1} of ${slides.length}`;
    previous.disabled = activeSlide === 0;
    next.disabled = activeSlide === slides.length - 1;
  }
  function open(id, { focus = false, update = true } = {}) {
    if (!tabs.some((t) => t.dataset.tab === id)) id = "plan";
    tabs.forEach((tab) => {
      const selected = tab.dataset.tab === id;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focus) tab.focus();
    });
    panels.forEach((panel) => {
      panel.hidden = panel.id !== id;
    });
    if (update) history.replaceState(null, "", `#${id}`);
  }
  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => open(tab.dataset.tab));
    tab.addEventListener("keydown", (event) => {
      let index;
      if (event.key === "ArrowRight") index = (i + 1) % tabs.length;
      else if (event.key === "ArrowLeft") index = (i - 1 + tabs.length) % tabs.length;
      else if (event.key === "Home") index = 0;
      else if (event.key === "End") index = tabs.length - 1;
      else return;
      event.preventDefault();
      open(tabs[index].dataset.tab, { focus: true });
    });
  });
  previous.addEventListener("click", () => showSlide(activeSlide - 1));
  next.addEventListener("click", () => showSlide(activeSlide + 1));
  root.querySelector(".ex-slide-viewer").addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      showSlide(activeSlide - 1);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      showSlide(activeSlide + 1);
    }
  });
  root.querySelectorAll("[data-open-slides]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      open("slides", { focus: true });
      showSlide(Number(link.dataset.openSlides));
    });
  });
  root.querySelectorAll("[data-print]").forEach((button) => {
    button.addEventListener("click", () => {
      document.body.classList.add("ex-printing");
      panels.forEach((p) => {
        p.classList.toggle("ex-print-target", p.id === button.dataset.print);
      });
      window.print();
    });
  });
  window.addEventListener("afterprint", () => {
    document.body.classList.remove("ex-printing");
    panels.forEach((p) => {
      p.classList.remove("ex-print-target");
    });
  });
  window.addEventListener("hashchange", () => open(location.hash.slice(1), { update: false }));
  open(location.hash.slice(1), { update: false });
  showSlide(0);
})();
