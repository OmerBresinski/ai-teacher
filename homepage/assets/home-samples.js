(() => {
  const root = document.querySelector("[data-home-samples]");
  if (!root) return;
  const tabs = [...root.querySelectorAll("[data-sample-tab]")];
  const panels = [...root.querySelectorAll("[data-sample-panel]")];
  function select(index, focus = false) {
    tabs.forEach((tab, i) => {
      tab.setAttribute("aria-selected", String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
      tab.classList.toggle("is-selected", i === index);
    });
    panels.forEach((panel, i) => {
      panel.hidden = i !== index;
    });
    if (focus) tabs[index].focus();
  }
  root.querySelector(".hm-sample-tabs").setAttribute("role", "tablist");
  tabs.forEach((tab, i) => {
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", panels[i].id);
    panels[i].setAttribute("role", "tabpanel");
    panels[i].setAttribute("aria-labelledby", tab.id);
    tab.addEventListener("click", (event) => {
      event.preventDefault();
      select(i);
    });
    tab.addEventListener("keydown", (event) => {
      let index;
      if (event.key === "ArrowRight") index = (i + 1) % tabs.length;
      else if (event.key === "ArrowLeft") index = (i + tabs.length - 1) % tabs.length;
      else if (event.key === "Home") index = 0;
      else if (event.key === "End") index = tabs.length - 1;
      else if (event.key === " ") index = i;
      else return;
      event.preventDefault();
      select(index, true);
    });
  });
  select(0);
})();
