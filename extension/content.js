(function startWangtuCapture() {
  "use strict";
  if (globalThis.__wangtuCaptureLoaded || !globalThis.WangtuCollector) return;
  globalThis.__wangtuCaptureLoaded = true;

  let timer = null;
  let observer = null;
  let lastFingerprint = "";
  let regionOverlay = null;
  const ignoredUrls = new Set();

  function safeSend(message) {
    try {
      const result = chrome.runtime.sendMessage(message);
      if (result && typeof result.catch === "function") result.catch(() => {});
    } catch {}
  }

  function snapshot(reason = "update") {
    const discovered = WangtuCollector.scanDocument(document, performance, location.href);
    const currentUrls = new Set(discovered.map((item) => item.url));
    for (const url of ignoredUrls) if (!currentUrls.has(url)) ignoredUrls.delete(url);
    const images = discovered.filter((item) => !ignoredUrls.has(item.url));
    const fingerprint = images.map((item) => `${item.url}|${item.width}x${item.height}`).join("\n");
    if (reason !== "manual" && fingerprint === lastFingerprint) return images;
    lastFingerprint = fingerprint;
    safeSend({
      type: "FRAME_SNAPSHOT",
      reason,
      page: {
        url: location.href,
        title: document.title || location.hostname,
        isTop: window === window.top,
      },
      images,
    });
    return images;
  }

  function clearCapturedImages() {
    const current = WangtuCollector.scanDocument(document, performance, location.href);
    for (const item of current) ignoredUrls.add(item.url);
    lastFingerprint = "";
    snapshot("manual");
  }

  function schedule(reason = "mutation", delay = 320) {
    clearTimeout(timer);
    timer = setTimeout(() => snapshot(reason), delay);
  }

  function removeRegionOverlay() {
    if (!regionOverlay) return;
    regionOverlay.remove();
    regionOverlay = null;
  }

  function startRegionCapture() {
    removeRegionOverlay();
    const overlay = document.createElement("div");
    const selection = document.createElement("div");
    const hint = document.createElement("div");
    regionOverlay = overlay;

    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      cursor: "crosshair",
      background: "rgba(10, 15, 8, .22)",
      userSelect: "none",
    });
    Object.assign(selection.style, {
      position: "fixed",
      display: "none",
      border: "2px solid #b8f34b",
      background: "rgba(184, 243, 75, .08)",
      boxShadow: "0 0 0 9999px rgba(10, 15, 8, .42)",
      pointerEvents: "none",
    });
    Object.assign(hint.style, {
      position: "fixed",
      left: "50%",
      top: "18px",
      transform: "translateX(-50%)",
      padding: "9px 14px",
      borderRadius: "10px",
      background: "#171a15",
      color: "white",
      font: "600 13px system-ui, sans-serif",
      boxShadow: "0 8px 28px rgba(0,0,0,.24)",
      pointerEvents: "none",
    });
    hint.textContent = "拖拽选择截图区域 · 按 Esc 取消";
    overlay.append(selection, hint);
    document.documentElement.appendChild(overlay);

    let startX = 0;
    let startY = 0;
    let dragging = false;

    function update(event) {
      const x = Math.max(0, Math.min(startX, event.clientX));
      const y = Math.max(0, Math.min(startY, event.clientY));
      const width = Math.min(window.innerWidth, Math.max(startX, event.clientX)) - x;
      const height = Math.min(window.innerHeight, Math.max(startY, event.clientY)) - y;
      Object.assign(selection.style, { display: "block", left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` });
      return { x, y, width, height };
    }

    overlay.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      update(event);
    });
    overlay.addEventListener("mousemove", (event) => {
      if (dragging) update(event);
    });
    overlay.addEventListener("mouseup", (event) => {
      if (!dragging || event.button !== 0) return;
      event.preventDefault();
      dragging = false;
      const rect = update(event);
      removeRegionOverlay();
      if (rect.width < 4 || rect.height < 4) {
        safeSend({ type: "REGION_CAPTURE_CANCELLED" });
        return;
      }
      requestAnimationFrame(() => safeSend({
        type: "REGION_SELECTED",
        rect,
        viewport: { width: window.innerWidth, height: window.innerHeight },
      }));
    });
    overlay.addEventListener("contextmenu", (event) => event.preventDefault());
    window.addEventListener("keydown", function cancel(event) {
      if (event.key !== "Escape" || !regionOverlay) return;
      removeRegionOverlay();
      window.removeEventListener("keydown", cancel, true);
      safeSend({ type: "REGION_CAPTURE_CANCELLED" });
    }, true);
  }

  function observe() {
    if (observer || !document.documentElement) return;
    observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.type === "childList" || mutation.type === "attributes")) schedule();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src", "srcset", "data-src", "data-srcset", "data-original", "style", "class"],
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    observe();
    schedule("dom-ready", 20);
  }, { once: true });

  window.addEventListener("load", () => schedule("window-load", 40), { once: true });
  document.addEventListener("load", (event) => {
    if (event.target?.tagName === "IMG") schedule("image-load", 80);
  }, true);

  try {
    const performanceObserver = new PerformanceObserver((list) => {
      if (list.getEntries().some((entry) => ["img", "image"].includes(entry.initiatorType))) schedule("network", 120);
    });
    performanceObserver.observe({ type: "resource", buffered: true });
  } catch {}

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "GET_FRAME_SNAPSHOT") {
      sendResponse({
        page: { url: location.href, title: document.title || location.hostname, isTop: window === window.top },
        images: snapshot("manual"),
      });
    } else if (message?.type === "RESCAN_FRAME") {
      snapshot("manual");
      sendResponse({ ok: true });
    } else if (message?.type === "START_REGION_CAPTURE") {
      if (window === window.top) startRegionCapture();
      sendResponse({ ok: window === window.top });
    } else if (message?.type === "CANCEL_REGION_CAPTURE") {
      removeRegionOverlay();
      sendResponse({ ok: true });
    } else if (message?.type === "CLEAR_CAPTURED_IMAGES") {
      clearCapturedImages();
      sendResponse({ ok: true });
    }
  });

  observe();
  schedule("initial", 30);
})();
