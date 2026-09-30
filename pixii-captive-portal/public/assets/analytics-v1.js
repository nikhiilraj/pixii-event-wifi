(() => {
  "use strict";
  const config = window.pixiiTracking;
  if (!config) return;
  let recordedOptOut = !!config.optOut || navigator.globalPrivacyControl === true;
  let storageUnavailable = false;
  try {
    recordedOptOut = recordedOptOut || localStorage.getItem("pixii_tracking_opt_out") === "1" || /(?:^|;\s*)pixii_tracking_opt_out=1(?:;|$)/.test(document.cookie);
    // Respect existing PostHog opt-out flags without reading identities.
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("__ph_opt_in_out_") && localStorage.getItem(key) === "0") recordedOptOut = true;
    }
  } catch { storageUnavailable = true; }
  const optOut = !!config.suppressed || recordedOptOut || storageUnavailable;
  window.pixiiTrackingSuppressed = optOut;
  window.pixiiTrackingOptOut = recordedOptOut;
  function report(event, method) {
    if (!config.context) return;
    const payload = { context: config.context, event, ...(method ? { method } : {}), optOut };
    try { fetch("/analytics/events", { method: "POST", credentials: "same-origin", keepalive: true,
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(1500) }).catch(() => {}); } catch { /* Never gate navigation. */ }
  }
  if (config.page === "form") {
    const form = document.getElementById("signup-form");
    if (form && optOut) {
      const input = document.createElement("input"); input.type = "hidden"; input.name = "analyticsOptOut"; input.value = "1"; form.appendChild(input);
    }
    const view = () => { if (document.visibilityState !== "visible") return; document.removeEventListener("visibilitychange", view); report("wifi_form_viewed"); };
    document.addEventListener("visibilitychange", view); view(); return;
  }
  if (config.page !== "connected") return;
  window.pixiiTrackOpen = method => report("wifi_pixii_open_requested", method);
  if (optOut) { report("wifi_pixii_open_requested", "automatic"); return; }
  const pixels = config.pixels || {};
  function load(src) { const script = document.createElement("script"); script.async = true; script.src = src; document.head.appendChild(script); }
  // Each vendor is isolated; a broken integration must not stop the others or Wi-Fi.
  try {
    if (pixels.meta) {
      const fbq = window.fbq = function (...args) { fbq.callMethod ? fbq.callMethod(...args) : fbq.queue.push(args); };
      fbq.queue = []; fbq.push = fbq; fbq.loaded = true; fbq.version = "2.0"; window._fbq = fbq;
      fbq("set", "autoConfig", false, pixels.meta);
      fbq("init", pixels.meta); fbq("track", "PageView"); fbq("trackCustom", "WifiConnected");
      load("https://connect.facebook.net/en_US/fbevents.js");
    }
  } catch { /* optional */ }
  try {
    if (pixels.google && pixels.google.length) {
      window.dataLayer = window.dataLayer || [];
      window.gtag = function () { window.dataLayer.push(arguments); };
      window.gtag("js", new Date());
      pixels.google.forEach(id => window.gtag("config", id));
      window.gtag("event", "wifi_connected", { send_to: pixels.google });
      load("https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(pixels.google[0]));
    }
  } catch { /* optional */ }
  try {
    if (pixels.linkedin) {
      window._linkedin_partner_id = pixels.linkedin; window._linkedin_data_partner_ids = [pixels.linkedin];
      window.lintrk = function (a,b) { window.lintrk.q.push([a,b]); }; window.lintrk.q = [];
      load("https://snap.licdn.com/li.lms-analytics/insight.min.js");
    }
  } catch { /* optional */ }
  try {
    if (pixels.rb2b) { window.reb2b = { loaded: true }; load("https://ddwl4m2hdecbv.cloudfront.net/b/" + pixels.rb2b + "/" + pixels.rb2b + ".js.gz"); }
  } catch { /* optional */ }
})();
