(() => {
  const form = document.querySelector("[data-hero-preview]");
  if (!form) return;
  const topic = form.querySelector("[data-brief-topic]");
  const status = form.querySelector("[data-brief-status]");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!topic.value.trim()) {
      topic.value = "";
      topic.reportValidity();
      return;
    }
    status.textContent =
      "Your topic is ready to try. DayBack’s lesson creation is not connected in this preview yet, so nothing was sent or saved.";
  });
  form.querySelector('button[type="submit"]').disabled = false;
})();
