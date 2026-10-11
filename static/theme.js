// Light/dark switcher. Explicit choice is saved in localStorage; without one, the OS setting wins.
(() => {
  const root = document.documentElement;
  const btn = document.querySelector(".theme-toggle");
  if (!btn) return;
  const media = matchMedia("(prefers-color-scheme: dark)");
  const current = () => root.dataset.theme || (media.matches ? "dark" : "light");

  // Icon shows the mode a click switches to: moon in light mode, sun in dark mode.
  const svg = (name, body) =>
    `<svg data-icon="${name}" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  const SUN = svg("sun", '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>');
  const MOON = svg("moon", '<path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z"/>');

  const render = () => {
    const dark = current() === "dark";
    btn.innerHTML = dark ? SUN : MOON;
    btn.setAttribute("aria-label", dark ? "Ganti ke mode terang" : "Ganti ke mode gelap");
    btn.title = btn.getAttribute("aria-label");
  };

  btn.addEventListener("click", () => {
    root.dataset.theme = current() === "dark" ? "light" : "dark";
    try { localStorage.setItem("theme", root.dataset.theme); } catch {}
    render();
  });
  media.addEventListener("change", render);
  render();
  btn.hidden = false;
})();
