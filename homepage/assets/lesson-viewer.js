// Lesson page behaviour. Without this script every slide stays visible in a grid and each sheet's
// answers follow it; with it, one large slide sits on the stage, a strip of thumbnails chooses
// between them, and an Answers switch reveals a slide's or a sheet's answers in the same place.
(() => {
  // A Questions | Answers group: exactly one button is pressed.
  const setView = (group, answers) => {
    for (const button of group.querySelectorAll("button")) {
      button.setAttribute("aria-pressed", String((button.dataset.view === "answers") === answers));
    }
  };
  const onView = (group, handler) => {
    group.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-view]");
      if (button) handler(button.dataset.view === "answers");
    });
  };
  for (const viewer of document.querySelectorAll("[data-viewer]")) {
    const slides = [...viewer.querySelectorAll(".viewer-slide")];
    const thumbs = [...viewer.querySelectorAll(".viewer-thumb")];
    const status = viewer.querySelector(".viewer-status");
    const steps = [...viewer.querySelectorAll(".viewer-step")];
    const controls = viewer.querySelector(".viewer-controls");
    const answers = viewer.querySelector("[data-slide-answers]");
    if (slides.length < 2 || !controls) continue;
    let current = 0;
    // Without this script each answer sits under its question; with it, answers wait for the switch.
    for (const answer of viewer.querySelectorAll("[data-answer]")) answer.hidden = true;

    // Each slide opens on its question; the switch appears only where a slide has answers.
    const showAnswer = (on) => {
      const slide = slides[current];
      const answer = slide.querySelector("[data-answer]");
      slide.querySelector("img:not([data-answer])").hidden = Boolean(answer && on);
      if (answer) answer.hidden = !on;
      setView(answers, Boolean(answer && on));
    };
    if (answers) onView(answers, showAnswer);

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
      // Reads "Slide 3 of 10"; a phone shows it as "3 / 10".
      status.innerHTML = `<span class="vs-word">Slide </span>${current + 1}<span class="vs-word"> of</span><span class="vs-total"> ${slides.length}</span>`;
      if (answers) {
        // Slides without answers keep the control's space but hide and disable it.
        const idle = !slides[current].hasAttribute("data-has-answer");
        answers.toggleAttribute("data-idle", idle);
        answers.inert = idle;
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
      // Arrow keys on the Questions | Answers switch belong to the switch, not the slides.
      if (event.target.closest?.(".view-switch")) return;
      event.preventDefault();
      const onThumb = event.target.classList?.contains("viewer-thumb");
      show(edge ?? current + delta, onThumb);
    });

    // On a phone the thumbnails give way to swiping the slide itself.
    const stage = viewer.querySelector(".viewer-slides");
    let start = null;
    stage.addEventListener(
      "touchstart",
      (event) => {
        const touch = event.touches[0];
        start = { x: touch.clientX, y: touch.clientY };
      },
      { passive: true },
    );
    stage.addEventListener(
      "touchend",
      (event) => {
        if (!start) return;
        const touch = event.changedTouches[0];
        const dx = touch.clientX - start.x;
        const dy = touch.clientY - start.y;
        start = null;
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5)
          show(current + (dx < 0 ? 1 : -1));
      },
      { passive: true },
    );

    controls.hidden = false;
    if (answers) answers.hidden = false;
    viewer.dataset.enhanced = "";
    show(0);
  }

  // A printed sheet and its answers share one place on the page.
  for (const doc of document.querySelectorAll("[data-paper]")) {
    const toggle = doc.querySelector(".view-switch");
    const sheet = doc.querySelector(".paper-sheet");
    const answers = doc.querySelector("[data-answers]");
    if (!toggle || !sheet || !answers) continue;
    const set = (on) => {
      setView(toggle, on);
      sheet.hidden = on;
      answers.hidden = !on;
    };
    onView(toggle, set);
    doc.dataset.enhanced = "";
    toggle.hidden = false;
    set(false);
  }
})();
