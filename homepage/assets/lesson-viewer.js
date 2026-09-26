// Slide viewer for a lesson page. Without this script every slide stays visible in a grid; with it,
// one large slide sits on the stage and a strip of thumbnails chooses between them.
(() => {
  for (const viewer of document.querySelectorAll("[data-viewer]")) {
    const slides = [...viewer.querySelectorAll(".viewer-slide")];
    const thumbs = [...viewer.querySelectorAll(".viewer-thumb")];
    const status = viewer.querySelector(".viewer-status");
    const steps = [...viewer.querySelectorAll(".viewer-step")];
    const controls = viewer.querySelector(".viewer-controls");
    if (slides.length < 2 || !controls) continue;
    let current = 0;

    const show = (index, focusThumb = false) => {
      current = (index + slides.length) % slides.length;
      slides.forEach((slide, i) => {
        slide.classList.toggle("is-current", i === current);
      });
      thumbs.forEach((thumb, i) => {
        const on = i === current;
        thumb.setAttribute("aria-pressed", String(on));
        if (on) thumb.setAttribute("aria-current", "true");
        else thumb.removeAttribute("aria-current");
        thumb.tabIndex = on ? 0 : -1;
      });
      status.textContent = `Slide ${current + 1} of ${slides.length}`;
      const thumb = thumbs[current];
      // Keep the chosen thumbnail in view inside its own strip, never by scrolling the page.
      const strip = thumb.parentElement;
      const left = thumb.offsetLeft;
      if (
        left < strip.scrollLeft ||
        left + thumb.offsetWidth > strip.scrollLeft + strip.clientWidth
      ) {
        strip.scrollLeft = left - (strip.clientWidth - thumb.offsetWidth) / 2;
      }
      if (focusThumb) thumb.focus();
    };

    for (const thumb of thumbs) {
      thumb.addEventListener("click", () => show(Number(thumb.dataset.index)));
    }
    for (const step of steps) {
      step.addEventListener("click", () => show(current + Number(step.dataset.step)));
    }
    viewer.addEventListener("keydown", (event) => {
      const delta = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
      const edge = { Home: 0, End: slides.length - 1 }[event.key];
      if (delta === undefined && edge === undefined) return;
      event.preventDefault();
      const onThumb = event.target.classList?.contains("viewer-thumb");
      show(edge ?? current + delta, onThumb);
    });

    controls.hidden = false;
    viewer.dataset.enhanced = "";
    show(0);
  }
})();
