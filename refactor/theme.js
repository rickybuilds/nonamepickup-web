(() => {
  const key = "noname2080-theme";
  const system = window.matchMedia?.("(prefers-color-scheme: dark)");
  let saved = null;
  try {
    saved = localStorage.getItem(key);
  } catch {}

  const apply = (theme) => {
    const night = theme === "night";
    document.documentElement.dataset.theme = night ? "night" : "day";
    document.documentElement.style.colorScheme = night ? "dark" : "light";
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      "content",
      night ? "#171b18" : "#e9e6dc",
    );
    const toggle = document.querySelector("#theme-toggle");
    if (toggle) {
      toggle.textContent = night ? "DAY /" : "NIGHT /";
      toggle.setAttribute("aria-pressed", String(night));
      toggle.title = night ? "Switch to day mode" : "Switch to night mode";
    }
  };

  apply(saved === "night" || saved === "day" ? saved : system?.matches ? "night" : "day");
  document.addEventListener("DOMContentLoaded", () => {
    document.querySelector("#theme-toggle")?.addEventListener("click", () => {
      saved = document.documentElement.dataset.theme === "night" ? "day" : "night";
      try {
        localStorage.setItem(key, saved);
      } catch {}
      apply(saved);
    });
    apply(document.documentElement.dataset.theme);
  });
  system?.addEventListener?.("change", (event) => {
    if (saved !== "night" && saved !== "day") apply(event.matches ? "night" : "day");
  });
})();
