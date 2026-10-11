// Site navigation without full reload: fetch the target page, swap <main> and <title>,
// update history. Links are plain hrefs, so everything still works without JS.
(() => {
  const main = document.getElementById("main");
  if (!main) return;
  history.scrollRestoration = "manual";
  history.replaceState({ nav: true, y: scrollY }, "");

  // Only same-origin blog pages: no /admin, no files (rss.xml, images), no new tabs/downloads.
  function internal(a) {
    if (a.target && a.target !== "_self") return null;
    if (a.hasAttribute("download")) return null;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin) return null;
    if (url.pathname.startsWith("/admin")) return null;
    if (/\.[a-z0-9]+$/i.test(url.pathname)) return null;
    if (url.pathname === location.pathname && url.hash) return null; // in-page anchor
    return url;
  }

  let pending = 0;
  async function load(url, { push, y = 0 }) {
    const ticket = ++pending; // ignore responses from superseded clicks
    main.setAttribute("aria-busy", "true");
    try {
      const res = await fetch(url, { headers: { accept: "text/html" } });
      if (!res.ok) throw new Error(res.status);
      const doc = new DOMParser().parseFromString(await res.text(), "text/html");
      const next = doc.getElementById("main");
      if (!next) throw new Error("no main");
      if (ticket !== pending) return;
      if (push) {
        history.replaceState({ ...history.state, y: scrollY }, "");
        history.pushState({ nav: true, y: 0 }, "", url);
      }
      main.innerHTML = next.innerHTML;
      document.title = doc.title;
      scrollTo(0, y);
      main.focus({ preventScroll: true });
    } catch {
      location.href = url; // fall back to a normal navigation
    } finally {
      if (ticket === pending) main.removeAttribute("aria-busy");
    }
  }

  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest("a[href]");
    const url = a && internal(a);
    if (!url) return;
    e.preventDefault();
    if (url.href === location.href) return;
    load(url.href, { push: true });
  });

  window.addEventListener("popstate", (e) => {
    if (e.state?.nav) load(location.href, { push: false, y: e.state.y || 0 });
  });
})();
