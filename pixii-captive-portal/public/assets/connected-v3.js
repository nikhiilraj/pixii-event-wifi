(() => {
  "use strict";
  const initialized = new WeakSet();

  // Best-effort app handoffs, never a promise that the OS will permit opening.
  // Safari's scheme is registered on current macOS; iOS availability varies.
  function browserTarget(destination) {
    const ua = navigator.userAgent || "";
    if (/Android/i.test(ua)) {
      return { label: "Open in your browser", href: "intent://" + destination.slice(8) + "#Intent;scheme=https;action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;S.browser_fallback_url=" + encodeURIComponent(destination) + ";end" };
    }
    if (/iPhone|iPad|iPod|Macintosh/i.test(ua)) {
      return { label: "Open in Safari", href: "x-safari-https://" + destination.slice(8) };
    }
    if (/Windows/i.test(ua)) {
      return { label: "Open in Edge", href: "microsoft-edge:" + destination };
    }
    return { label: "Open in your browser", href: destination };
  }

  function start() {
    const link = document.querySelector(".online .arrow-cta");
    if (!link || initialized.has(link)) return;
    initialized.add(link);
    // Announce the new screen once, including the upcoming redirect. Avoid
    // announcing every timer tick or taking focus from someone already using it.
    if (document.activeElement === document.body) {
      link.closest(".online").querySelector(".connection-state").focus({ preventScroll: true });
    }
    // Keep the ordinary HTTPS destination separate from the click-only app URI.
    const destination = link.href;
    const target = browserTarget(destination);
    link.href = target.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    document.getElementById("browser-action").textContent = target.label;
    const note = document.getElementById("redirect-note");
    const fallback = document.getElementById("browser-fallback");
    const copyButton = document.getElementById("copy-pixii-link");
    const copyStatus = document.getElementById("copy-status");
    const copyField = document.getElementById("pixii-link");
    const bar = link.closest(".online").querySelector('[role="progressbar"]');
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
      bar.setAttribute("aria-valuetext", "Opening Pixii here in " + seconds + " seconds");
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
        location.assign(destination);
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
    link.addEventListener("click", () => {
      // Native navigation stays on this trusted click, not a delayed popup.
      stop();
      bar.hidden = true;
      note.textContent = "If your browser didn’t open, open Pixii here or copy the link into your browser.";
      fallback.hidden = false;
    });
    copyButton.addEventListener("click", async () => {
      stop();
      try {
        await navigator.clipboard.writeText(destination);
        copyStatus.textContent = "Link copied. Paste it into your browser.";
      } catch {
        copyField.hidden = false;
        copyField.value = destination;
        copyField.focus();
        copyField.select();
        copyStatus.textContent = "Copy this link and paste it into your browser.";
      }
    });
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", pagehide);
    window.addEventListener("pageshow", pageshow);
    draw();
    frame = requestAnimationFrame(tick);
  }
  document.addEventListener("pixii:connected", start);
  start();
})();
