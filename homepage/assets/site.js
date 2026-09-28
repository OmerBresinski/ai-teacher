(() => {
  const menu = document.querySelector(".menu-toggle"),
    nav = document.querySelector("#main-nav");
  if (!menu || !nav) return;
  const setOpen = (open) => {
    menu.setAttribute("aria-expanded", String(open));
    nav.classList.toggle("open", open);
  };
  menu.addEventListener("click", () => setOpen(menu.getAttribute("aria-expanded") !== "true"));
  // The phone menu lies over the page, so a tap outside it or on one of its links closes it.
  document.addEventListener("click", (e) => {
    if (!nav.classList.contains("open") || menu.contains(e.target)) return;
    if (!nav.contains(e.target) || e.target.closest("a")) setOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && nav.classList.contains("open")) {
      setOpen(false);
      menu.focus();
    }
  });
})();
