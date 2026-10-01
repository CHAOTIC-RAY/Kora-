// Shared behaviour for the three documentation pages.
//
// Only two interactive things exist, and both are real: a theme toggle that
// repaints and remembers, and a mobile nav drawer. There is no simulated
// product demo and no copy-link affordance that does not copy anything.
(function () {
  "use strict";

  var root = document.documentElement;
  var btn = document.getElementById("theme");
  var KEY = "kora-docs-theme";

  function stored() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function systemPrefersNight() {
    return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  }

  var current = stored() || (systemPrefersNight() ? "night" : "paper");

  function apply(mode) {
    current = mode;
    root.setAttribute("data-theme", mode);
    btn.textContent = mode === "night" ? "Paper" : "Night";
    btn.setAttribute("aria-label",
      mode === "night" ? "Switch to the light theme" : "Switch to the dark theme");
  }

  apply(current);

  btn.addEventListener("click", function () {
    var next = current === "night" ? "paper" : "night";
    try { localStorage.setItem(KEY, next); } catch (e) { /* private mode */ }
    apply(next);
  });

  /* Mobile nav */
  var toggle = document.getElementById("navToggle");
  var nav = document.getElementById("nav");

  function closeNav() {
    nav.classList.remove("open");
    toggle.setAttribute("aria-expanded", "false");
  }

  toggle.addEventListener("click", function () {
    var open = nav.classList.toggle("open");
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  });

  // Tapping a nav link jumps to a section that would otherwise sit under the
  // open drawer, so close it on the way.
  nav.addEventListener("click", function (e) {
    if (e.target.closest("a")) closeNav();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && nav.classList.contains("open")) {
      closeNav();
      toggle.focus();
    }
  });

  /* Copy buttons: copy the code block they belong to. */
  Array.prototype.forEach.call(document.querySelectorAll(".copy"), function (b) {
    b.addEventListener("click", function () {
      var pre = b.parentNode.querySelector("pre");
      if (!pre) return;
      var old = b.textContent;
      var done = function () {
        b.textContent = "Copied";
        b.classList.add("done");
        setTimeout(function () { b.textContent = old; b.classList.remove("done"); }, 1400);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(pre.innerText).then(done, function () {});
      }
    });
  });

  /* Scroll spy for the section list. With several sections on screen at once,
     the topmost wins. */
  var links = Array.prototype.slice.call(nav.querySelectorAll('a[href^="#"]'));
  var targets = links.map(function (a) {
    return document.getElementById(a.getAttribute("href").slice(1));
  }).filter(Boolean);

  if ("IntersectionObserver" in window && targets.length) {
    var visible = new Set();
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) visible.add(en.target);
        else visible.delete(en.target);
      });
      var best = null;
      targets.forEach(function (t) {
        if (visible.has(t) && (!best || t.getBoundingClientRect().top < best.getBoundingClientRect().top)) best = t;
      });
      if (!best) return;
      links.forEach(function (a) {
        var on = a.getAttribute("href") === "#" + best.id;
        if (on) a.setAttribute("aria-current", "true");
        else a.removeAttribute("aria-current");
      });
    }, { rootMargin: "-72px 0px -66% 0px", threshold: 0 });
    targets.forEach(function (t) { spy.observe(t); });
  }
})();
