(() => {
  const embedded = new URLSearchParams(location.search).has("embed");
  if (embedded) document.body.classList.add("embedded");
  const $ = (s) => document.querySelector(s);
  const names = ["Plan", "Slides", "Worksheet", "Answers"];
  const stages = [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3];
  const copy = [
    "Planning your lesson.",
    "Making your slides.",
    "Creating your worksheet.",
    "Checking your lesson.",
    "Your lesson is ready.",
  ];
  let lastStage = -1,
    changeTimer = 0,
    frame = 0;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const live = $(".live-copy"),
    track = $(".progress-track"),
    parts = [...track.children];
  function updateCopy(stage) {
    clearTimeout(changeTimer);
    live.getAnimations().forEach((a) => {
      a.cancel();
    });
    const apply = () => {
      $("#loading-title").textContent = copy[stage];
      if (lastStage >= 0 && !reduced.matches)
        live.animate(
          [
            { opacity: 0, transform: "translateY(4px)" },
            { opacity: 1, transform: "translateY(0)" },
          ],
          { duration: 480, easing: "cubic-bezier(.22,1,.36,1)" },
        );
    };
    if (lastStage < 0 || reduced.matches) apply();
    else {
      live.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, fill: "forwards" });
      changeTimer = setTimeout(() => {
        live.getAnimations().forEach((a) => {
          a.cancel();
        });
        apply();
      }, 180);
    }
  }
  // The visible cast is a status display. Beat navigation belongs to the inspector.
  $("#cast").addEventListener(
    "click",
    (event) => {
      event.stopImmediatePropagation();
    },
    true,
  );
  $("#cast")
    .querySelectorAll("button")
    .forEach((button) => {
      button.tabIndex = -1;
      button.setAttribute("aria-disabled", "true");
    });
  function render() {
    const state = window.GatherProduction.state;
    const stage = state.complete ? 4 : stages[state.beat];
    if (stage !== lastStage) {
      updateCopy(stage);
      lastStage = stage;
      parts.forEach((part, i) => {
        part.classList.toggle("done", i < stage);
        part.classList.toggle("active", i === stage);
        part.setAttribute("aria-current", i === stage ? "step" : "false");
      });
      track.setAttribute("aria-valuenow", stage);
      track.setAttribute(
        "aria-valuetext",
        stage === 4
          ? "All four stages complete."
          : `${names[stage]} in progress. ${stage} of 4 stages complete.`,
      );
      $("#scene").setAttribute("aria-busy", String(stage !== 4));
      document.body.classList.toggle("is-ready", stage === 4);
      $("#sample-link").tabIndex = stage === 4 ? 0 : -1;
      $("#sample-link").setAttribute("aria-hidden", String(stage !== 4));
    }
    frame = requestAnimationFrame(render);
  }
  document.querySelector(".production-scene > path").setAttribute("d", "M175 303H465");
  const sliders = [...document.querySelectorAll("[data-motion]")];
  function adjustMotion(input) {
    const key = input.dataset.motion,
      value = Number(input.value);
    window.GatherProduction.setAmbient({ [key]: value });
    document.querySelector(`#value-${key}`).value =
      key === "tempo" ? `${value.toFixed(2).replace(/0$/, "")}×` : `${Math.round(value * 100)}%`;
  }
  sliders.forEach((input) => {
    input.addEventListener("input", () => adjustMotion(input));
  });
  document.querySelector("#reset-motion").addEventListener("click", () =>
    sliders.forEach((input) => {
      input.value = input.defaultValue;
      adjustMotion(input);
    }),
  );
  render();
  window.addEventListener("pagehide", () => {
    cancelAnimationFrame(frame);
    clearTimeout(changeTimer);
  });
})();

if (new URLSearchParams(location.search).has("embed")) {
  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin || event.source !== parent) return;
    const button = document.querySelector("#pause");
    if (event.data?.type === "gather-replay") document.querySelector("#restart").click();
    if (event.data?.type === "gather-pause" && button.getAttribute("aria-pressed") === "false")
      button.click();
    if (event.data?.type === "gather-play" && button.getAttribute("aria-pressed") === "true")
      button.click();
  });
}
