(() => {
  "use strict";
  const initialized = new WeakSet();
  function start() {
    const link = document.querySelector(".online .arrow-cta");
    if (!link || initialized.has(link)) return;
    initialized.add(link);
    const bar = link.querySelector('[role="progressbar"]');
    const fill = bar.querySelector("span");
    const remaining = document.getElementById("redirect-seconds");
    const total = 5000;
    let elapsed = 0;
    let last = document.visibilityState === "visible" ? performance.now() : null;
    let frame = 0, leaving = false;

    function draw() {
      fill.style.transform = "scaleX(" + elapsed / total + ")";
      bar.setAttribute("aria-valuenow", String(Math.floor(elapsed / total * 100)));
      const seconds = Math.ceil((total - elapsed) / 1000);
      remaining.textContent = String(seconds);
      bar.setAttribute("aria-valuetext", "Opening Pixii in " + seconds + " seconds");
    }
    function accumulate() {
      const now = performance.now();
      if (last !== null) elapsed = Math.min(total, elapsed + Math.max(0, now - last));
      last = document.visibilityState === "visible" ? now : null;
    }
    function stop() {
      leaving = true;
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", pagehide);
      window.removeEventListener("pageshow", pageshow);
    }
    function tick() {
      if (leaving) return;
      if (!link.isConnected) { stop(); return; }
      accumulate();
      draw();
      if (elapsed >= total && document.visibilityState === "visible") {
        stop();
        location.assign(link.href);
        return;
      }
      frame = requestAnimationFrame(tick);
    }
    function visibility() { accumulate(); draw(); }
    function pagehide() { accumulate(); last = null; cancelAnimationFrame(frame); }
    function pageshow(event) {
      if (!event.persisted || leaving) return;
      last = document.visibilityState === "visible" ? performance.now() : null;
      frame = requestAnimationFrame(tick);
    }
    link.addEventListener("click", stop, { once: true });
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", pagehide);
    window.addEventListener("pageshow", pageshow);
    draw();
    frame = requestAnimationFrame(tick);
  }
  document.addEventListener("pixii:connected", start);
  start();
})();
