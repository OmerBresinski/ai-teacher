(() => {
  const menu = document.querySelector(".menu-toggle"),
    nav = document.querySelector("#main-nav");
  menu?.addEventListener("click", () => {
    const open = menu.getAttribute("aria-expanded") !== "true";
    menu.setAttribute("aria-expanded", String(open));
    nav.classList.toggle("open", open);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && nav?.classList.contains("open")) {
      nav.classList.remove("open");
      menu.setAttribute("aria-expanded", "false");
      menu.focus();
    }
  });
  document.querySelectorAll("[data-preview-form]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const status = form.querySelector("[data-form-status]");
      if (status) {
        status.textContent =
          "Your details pass the form check. This preview isn’t connected to a sending service, so nothing has been sent or saved.";
        status.tabIndex = -1;
        status.focus();
      }
    });
  });
  let motionPaused = false;
  const frames = [...document.querySelectorAll('iframe[src*="lesson-building"]')];
  const setFrame = (frame, active) =>
    frame.contentWindow?.postMessage(
      { type: active && !motionPaused ? "gather-play" : "gather-pause" },
      location.origin,
    );
  const observer = new IntersectionObserver(
    (entries) =>
      entries.forEach((e) => {
        setFrame(e.target, e.isIntersecting);
      }),
    { threshold: 0.2 },
  );
  frames.forEach((frame) => {
    observer.observe(frame);
    frame.addEventListener("load", () => {
      const r = frame.getBoundingClientRect();
      setFrame(frame, r.bottom > 0 && r.top < innerHeight);
    });
  });
  document.querySelector("[data-pause-cast]")?.addEventListener("click", (event) => {
    motionPaused = event.currentTarget.getAttribute("aria-pressed") === "true";
    frames.forEach((frame) => {
      const r = frame.getBoundingClientRect();
      setFrame(frame, r.bottom > 0 && r.top < innerHeight);
    });
  });
})();
