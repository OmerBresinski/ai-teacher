// Lesson page behaviour. Without this script every slide stays visible in a grid and each sheet's
// answers follow it; with it, one large slide sits on the stage, a strip of thumbnails chooses
// between them, and an Answers switch reveals a slide's or a sheet's answers in the same place.
(() => {
  const setSwitch = (button, on) => button.setAttribute("aria-checked", String(on));
  for (const viewer of document.querySelectorAll("[data-viewer]")) {
    const slides = [...viewer.querySelectorAll(".viewer-slide")];
    const thumbs = [...viewer.querySelectorAll(".viewer-thumb")];
    const status = viewer.querySelector(".viewer-status");
    const steps = [...viewer.querySelectorAll(".viewer-step")];
    const controls = viewer.querySelector(".viewer-controls");
    const bar = viewer.querySelector(".viewer-bar");
    const answers = viewer.querySelector("[data-slide-answers]");
    if (slides.length < 2 || !controls) continue;
    let current = 0;

    // Each slide opens on its question; the switch appears only where a slide has answers.
    const showAnswer = (on) => {
      const slide = slides[current];
      const answer = slide.querySelector("[data-answer]");
      slide.querySelector("img:not([data-answer])").hidden = Boolean(answer && on);
      if (answer) answer.hidden = !on;
      setSwitch(answers, Boolean(answer && on));
    };
    answers?.addEventListener("click", () => {
      showAnswer(answers.getAttribute("aria-checked") !== "true");
    });

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
      if (answers) {
        answers.hidden = !slides[current].hasAttribute("data-has-answer");
        showAnswer(false);
      }
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
    if (bar) bar.hidden = false;
    viewer.dataset.enhanced = "";
    show(0);
  }

  // A printed sheet and its answers share one place on the page.
  for (const doc of document.querySelectorAll("[data-paper]")) {
    const toggle = doc.querySelector(".answer-toggle");
    const sheet = doc.querySelector(".paper-sheet");
    const answers = doc.querySelector("[data-answers]");
    if (!toggle || !sheet || !answers) continue;
    const set = (on) => {
      setSwitch(toggle, on);
      sheet.hidden = on;
      answers.hidden = !on;
    };
    toggle.addEventListener("click", () => set(toggle.getAttribute("aria-checked") !== "true"));
    doc.dataset.enhanced = "";
    toggle.hidden = false;
    set(false);
  }
})();
