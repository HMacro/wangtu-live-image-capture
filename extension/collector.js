(function initWangtuCollector(root) {
  "use strict";

  const IMAGE_EXTENSIONS = /\.(?:avif|bmp|gif|heic|heif|ico|jpe?g|png|svg|webp)(?:$|[?#])/i;
  const CSS_URL = /url\(\s*(["']?)(.*?)\1\s*\)/gi;
  const MAX_IMAGES = 600;
  const MAX_STYLE_ELEMENTS = 3000;

  function normalizeUrl(value, baseUrl) {
    if (!value || typeof value !== "string") return null;
    const raw = value.trim().replace(/&amp;/g, "&");
    if (!raw || /^(?:javascript:|mailto:|#)/i.test(raw)) return null;
    if (/^data:/i.test(raw)) return raw.length <= 1_000_000 ? raw : null;
    try {
      const url = new URL(raw, baseUrl);
      if (!["http:", "https:", "blob:"].includes(url.protocol)) return null;
      url.hash = "";
      return url.href;
    } catch {
      return null;
    }
  }

  function parseSrcset(value) {
    if (!value || typeof value !== "string") return [];
    return value
      .split(",")
      .map((part) => part.trim().split(/\s+/)[0])
      .filter(Boolean);
  }

  function imageType(url) {
    if (/^data:image\//i.test(url)) {
      return (url.match(/^data:image\/([^;,]+)/i)?.[1] || "IMG").toUpperCase().replace("JPEG", "JPG");
    }
    try {
      const match = new URL(url).pathname.match(/\.([a-z0-9]{2,5})$/i);
      const type = match ? match[1].toUpperCase() : "IMG";
      return type === "JPEG" ? "JPG" : type;
    } catch {
      return "IMG";
    }
  }

  function fileName(url, index = 0) {
    if (/^data:/i.test(url)) return `embedded-${index + 1}.${imageType(url).toLowerCase()}`;
    try {
      const name = decodeURIComponent(new URL(url).pathname.split("/").pop() || "");
      return sanitizeFileName(name || `image-${index + 1}.${imageType(url).toLowerCase()}`);
    } catch {
      return `image-${index + 1}.jpg`;
    }
  }

  function sanitizeFileName(value) {
    return String(value || "image").replace(/[\\/:*?"<>|\x00-\x1f]/g, "-").slice(0, 140) || "image";
  }

  function scanDocument(doc, perf, frameUrl) {
    const baseUrl = doc.baseURI || frameUrl;
    const records = new Map();
    const now = Date.now();

    function add(rawUrl, details = {}) {
      if (records.size >= MAX_IMAGES) return;
      const url = normalizeUrl(rawUrl, baseUrl);
      if (!url) return;
      const previous = records.get(url);
      const width = Number(details.width || 0);
      const height = Number(details.height || 0);
      if (previous) {
        if (width * height > previous.width * previous.height) {
          previous.width = width;
          previous.height = height;
        }
        previous.lastSeen = now;
        if (!previous.alt && details.alt) previous.alt = String(details.alt).slice(0, 180);
        return;
      }
      records.set(url, {
        url,
        width,
        height,
        alt: String(details.alt || "").slice(0, 180),
        source: details.source || "DOM",
        type: imageType(url),
        frameUrl,
        firstSeen: now,
        lastSeen: now,
      });
    }

    for (const image of doc.querySelectorAll?.("img") || []) {
      const details = {
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height,
        alt: image.alt,
        source: "IMG",
      };
      add(image.currentSrc, details);
      for (const name of ["src", "data-src", "data-original", "data-lazy-src", "data-url"]) add(image.getAttribute?.(name), details);
      for (const name of ["srcset", "data-srcset"]) {
        for (const candidate of parseSrcset(image.getAttribute?.(name))) add(candidate, { ...details, source: "SRCSET" });
      }
    }

    for (const source of doc.querySelectorAll?.("source") || []) {
      for (const name of ["srcset", "data-srcset"]) {
        for (const candidate of parseSrcset(source.getAttribute?.(name))) add(candidate, { source: "SOURCE" });
      }
    }

    for (const meta of doc.querySelectorAll?.("meta[property='og:image'],meta[property='og:image:url'],meta[name='twitter:image'],meta[name='twitter:image:src']") || []) {
      add(meta.getAttribute?.("content"), { source: "META" });
    }

    for (const link of doc.querySelectorAll?.("link[rel~='preload'][as='image'],link[rel~='image_src']") || []) {
      add(link.href || link.getAttribute?.("href"), { source: "PRELOAD" });
      for (const candidate of parseSrcset(link.getAttribute?.("imagesrcset"))) add(candidate, { source: "PRELOAD" });
    }

    const styled = Array.from(doc.querySelectorAll?.("body *") || []).slice(0, MAX_STYLE_ELEMENTS);
    for (const element of styled) {
      let background = element.style?.backgroundImage || "";
      if ((!background || background === "none") && doc.defaultView?.getComputedStyle) {
        try { background = doc.defaultView.getComputedStyle(element).backgroundImage || ""; } catch {}
      }
      CSS_URL.lastIndex = 0;
      for (const match of background.matchAll(CSS_URL)) add(match[2], { source: "CSS" });
    }

    let entries = [];
    try { entries = perf?.getEntriesByType?.("resource") || []; } catch {}
    for (const entry of entries) {
      if (["img", "image"].includes(entry.initiatorType) || IMAGE_EXTENSIONS.test(entry.name || "")) {
        add(entry.name, { source: "NETWORK" });
      }
    }

    return Array.from(records.values()).map((record, index) => ({
      ...record,
      fileName: fileName(record.url, index),
    }));
  }

  root.WangtuCollector = {
    normalizeUrl,
    parseSrcset,
    imageType,
    fileName,
    sanitizeFileName,
    scanDocument,
  };
})(globalThis);
