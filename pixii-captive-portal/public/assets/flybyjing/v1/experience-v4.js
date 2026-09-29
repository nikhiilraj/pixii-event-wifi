(() => {
  "use strict";
  const config = window.pixiiAd;
  if (!config) return;
  const total = 7000;
  const status = document.getElementById("status-message");
  const bar = document.getElementById("ad-progress");
  const fill = bar.querySelector("span");
  const category = document.getElementById("ad-category");
  const categories = { listings: "Listings", aplus: "A+", video: "Ads" };
  const scenes = [...document.querySelectorAll(".flyby-scene")];
  const videos = [...document.querySelectorAll(".flyby-film video")];
  const pauseVideos = () => videos.forEach(video => video.pause());
  const reducedMotion = window.matchMedia("(prefers-reduced-motion:reduce)").matches;
  const storageKey = "pixii-ad:" + config.registrationId;
  let elapsed = 0, progress = 0, last = null, started = false, stopped = false, completing = false;
  let sceneName = "listings", sceneReady = true, checkpointAt = 0, checkpointBusy = false;
  const visible = () => document.visibilityState === "visible";
  const stored = () => { try { return Math.max(0, Math.min(total, Number(sessionStorage.getItem(storageKey)) || 0)); } catch { return 0; } };
  const save = () => { try { sessionStorage.setItem(storageKey, String(Math.floor(progress))); } catch { /* D1 checkpoints still work in restricted browsers. */ } };
  const expired = () => {
    stopped = true; last = null; pauseVideos();
    status.textContent = "This connection request expired. Rejoin the Wi-Fi and try again.";
  };
  async function boundedJson(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      const data = await response.json();
      return { response, data };
    }
    finally { clearTimeout(timeout); }
  }
  async function post(action, value, keepalive = false) {
    const { response, data } = await boundedJson("/router/fas/ad/" + action, {
      method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", keepalive,
      body: JSON.stringify({ registrationId: config.registrationId, token: config.token, visibleMs: Math.floor(value) })
    });
    if ([403, 404, 410].includes(response.status)) { expired(); throw new Error("expired"); }
    if (!response.ok && response.status !== 425) throw new Error("unavailable");
    return { ...data, early: response.status === 425 };
  }
  async function checkpoint(keepalive = false) {
    if (config.preview || !started || stopped || (checkpointBusy && !keepalive)) return;
    checkpointBusy = true;
    try { await post("start", progress, keepalive); } catch { /* Retry; never unlock on failure. */ }
    finally { checkpointBusy = false; }
  }
  function accumulate() {
    const now = performance.now();
    if (last !== null) elapsed += Math.max(0, now - last);
    progress = Math.min(total, elapsed);
    last = started && visible() && sceneReady && !stopped ? now : null;
    if (started) save();
  }
  function drawProgress() {
    const remaining = Math.ceil((total - progress) / 1000);
    fill.style.transform = "scaleX(" + progress / total + ")";
    bar.setAttribute("aria-valuenow", String(Math.floor(progress / total * 100)));
    bar.setAttribute("aria-valuetext", remaining ? remaining + " seconds remaining" : "Minimum complete; waiting for connection");
  }
  function playVideos() {
    if (sceneName !== "video" || !visible() || stopped || reducedMotion || !document.querySelector('[data-scene="video"].is-active')) return;
    const expected = Math.max(0, Math.min(1.95, (elapsed % total - 5000) / 1000));
    for (const video of videos) {
      const film = video.closest(".flyby-film");
      video.muted = true;
      if (video.readyState >= 1 && Math.abs(video.currentTime - expected) > .35) video.currentTime = expected;
      try {
        const playing = video.play();
        if (playing) playing.catch(() => film.classList.remove("is-playing"));
      } catch { film.classList.remove("is-playing"); }
    }
  }
  for (const video of videos) {
    const film = video.closest(".flyby-film");
    video.addEventListener("playing", () => film.classList.add("is-playing"));
    video.addEventListener("error", () => film.classList.remove("is-playing"));
    video.addEventListener("loadeddata", playVideos);
  }
  function waitForImage(image) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => finish(false), 8000);
      function finish(ok) {
        clearTimeout(timeout);
        image.removeEventListener("load", loaded);
        image.removeEventListener("error", failed);
        if (ok) resolve(); else reject(new Error("image unavailable"));
      }
      function loaded() { image.decode().then(() => finish(true), () => finish(image.naturalWidth > 0)); }
      function failed() { finish(false); }
      if (image.complete) { if (image.naturalWidth > 0) loaded(); else failed(); }
      else { image.addEventListener("load", loaded, { once: true }); image.addEventListener("error", failed, { once: true }); }
    });
  }
  function reloadFirstArtwork() {
    const image = document.getElementById("ad-first-artwork");
    const url = new URL(image.currentSrc || image.src, location.href);
    url.searchParams.set("retry", String(Date.now()));
    image.removeAttribute("srcset");
    image.src = url.toString();
  }
  // Runs even when artwork or ad-start is stalled. It can expire a session, never unlock it.
  async function watchExpiry() {
    if (stopped || config.preview) return;
    try {
      const { response, data } = await boundedJson(config.endpoint, { cache: "no-store" });
      if (stopped) return;
      if (response.status === 404 || response.status === 410) { expired(); return; }
      if (response.ok && data.status === "expired") { expired(); return; }
    } catch { /* Retry independently of the media/start loop. */ }
    if (!stopped) setTimeout(watchExpiry, 4000);
  }
  async function switchScene(next) {
    if (next === sceneName) return;
    accumulate(); sceneReady = false; last = null; pauseVideos();
    const scene = scenes.find(element => element.dataset.scene === next);
    const images = [...scene.querySelectorAll("img")].filter(image => getComputedStyle(image).display !== "none" && getComputedStyle(image.parentElement).display !== "none");
    try { await Promise.all(images.map(waitForImage)); } catch { /* Keep the previous loaded artwork as fallback. */ }
    if (stopped) return;
    const loaded = images.every(image => image.naturalWidth > 0);
    if (loaded) for (const element of scenes) {
      const active = element === scene;
      element.classList.toggle("is-active", active);
      element.setAttribute("aria-hidden", String(!active));
    }
    if (loaded) category.textContent = categories[next];
    sceneName = next; sceneReady = true; last = visible() ? performance.now() : null;
    if (next === "video" && loaded) { videos.forEach(video => { video.currentTime = 0; }); playVideos(); }
  }
  async function pollConnection() {
    if (stopped) return;
    try {
      const { response, data } = await boundedJson(config.endpoint, { cache: "no-store", headers: { accept: "application/json" } });
      // A newer expiry response is terminal, even if this older request says connected.
      if (stopped) return;
      if (response.status === 404) { expired(); return; }
      if (!response.ok) throw new Error("unavailable");
      if (data.status === "expired") { expired(); return; }
      if (data.status === "connected") {
        stopped = true; pauseVideos(); document.body.classList.remove("flyby-ad");
        document.title = "You're online | Pixii";
        document.querySelector("main").innerHTML = config.connectedHtml;
        document.dispatchEvent(new Event("pixii:connected"));
        try { sessionStorage.removeItem(storageKey); } catch { /* optional */ }
        return;
      }
    } catch { /* Router/network may take longer than the ad. */ }
    setTimeout(pollConnection, 700);
  }
  async function finish() {
    if (completing || stopped || !visible()) return;
    completing = true; status.textContent = "Finishing connection…";
    if (config.preview) { status.textContent = "Connecting you to Wi-Fi"; return; }
    try {
      const result = await post("complete", total);
      if (result.early) { completing = false; setTimeout(finish, Math.max(250, result.remainingMs || 250)); return; }
      void pollConnection();
    } catch {
      completing = false;
      if (!stopped) setTimeout(finish, 1500);
    }
  }
  function tick() {
    if (stopped) return;
    accumulate(); drawProgress();
    if (sceneReady) {
      // The authorization clock stops at seven seconds; the artwork keeps cycling.
      const cycle = elapsed % total;
      const next = cycle < 3000 ? "listings" : cycle < 5000 ? "aplus" : "video";
      if (next !== sceneName) void switchScene(next);
    }
    if (!config.preview && progress - checkpointAt >= 1000) { checkpointAt = progress; void checkpoint(); }
    if (progress >= total) void finish();
    requestAnimationFrame(tick);
  }
  document.addEventListener("visibilitychange", () => {
    accumulate(); last = visible() && sceneReady && started && !stopped ? performance.now() : null;
    if (!visible()) { pauseVideos(); void checkpoint(true); }
    else { playVideos(); if (progress >= total) void finish(); }
  });
  window.addEventListener("pagehide", () => { accumulate(); pauseVideos(); void checkpoint(true); });
  window.addEventListener("pageshow", event => { if (event.persisted) last = visible() && sceneReady ? performance.now() : null; });
  async function start() {
    try {
      await waitForImage(document.getElementById("ad-first-artwork"));
      if (!visible()) await new Promise(resolve => {
        const onVisible = () => { if (visible()) { document.removeEventListener("visibilitychange", onVisible); resolve(); } };
        document.addEventListener("visibilitychange", onVisible);
      });
      const result = config.preview ? { visibleMs: 0, completed: false } : await post("start", stored());
      elapsed = progress = result.completed ? total : result.visibleMs;
      if (stopped) return;
      status.textContent = "Connecting you to Wi-Fi";
      started = true; last = visible() ? performance.now() : null; checkpointAt = progress;
      if (!config.preview) history.replaceState(null, "", config.endpoint.replace("/status/", "/wait/"));
      requestAnimationFrame(tick);
    } catch {
      if (!stopped) {
        status.textContent = "Loading your connection…";
        const image = document.getElementById("ad-first-artwork");
        if (!image.naturalWidth) reloadFirstArtwork();
        setTimeout(start, 1500);
      }
    }
  }
  void start();
  if (!config.preview) setTimeout(watchExpiry, 4000);
})();
