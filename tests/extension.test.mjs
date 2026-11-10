import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(resolve(root, "extension", "manifest.json"), "utf8"));
const collectorSource = await readFile(resolve(root, "extension", "collector.js"), "utf8");
const sidepanelHtml = await readFile(resolve(root, "extension", "sidepanel.html"), "utf8");

function loadCollector() {
  const context = vm.createContext({ URL });
  context.globalThis = context;
  vm.runInContext(collectorSource, context, { filename: "collector.js" });
  return context.WangtuCollector;
}

function node(attributes = {}) {
  return { ...attributes, getAttribute(name) { return attributes[name] ?? null; } };
}

test("manifest 使用 Side Panel、下载权限和全站内容脚本", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.side_panel.default_path, "sidepanel.html");
  assert.ok(manifest.permissions.includes("sidePanel"));
  assert.ok(manifest.permissions.includes("downloads"));
  assert.ok(manifest.permissions.includes("activeTab"));
  assert.equal(manifest.icons[128], "icons/icon128.png");
  assert.equal(manifest.action.default_icon[32], "icons/icon32.png");
  assert.deepEqual(manifest.content_scripts[0].matches, ["http://*/*", "https://*/*"]);
  assert.equal(manifest.content_scripts[0].all_frames, true);
});

test("资源工具可规范化链接、解析 srcset 和清理文件名", () => {
  const collector = loadCollector();
  assert.equal(collector.normalizeUrl("../image/a.png#x", "https://example.com/path/page"), "https://example.com/image/a.png");
  assert.deepEqual(Array.from(collector.parseSrcset("small.jpg 1x, large.jpg 2x")), ["small.jpg", "large.jpg"]);
  assert.equal(collector.imageType("https://example.com/a.jpeg?q=1"), "JPG");
  assert.equal(collector.sanitizeFileName('a:b?.png'), "a-b-.png");
});

test("扫描动态页面中的 IMG、懒加载、SRCSET、CSS 和网络图片", () => {
  const collector = loadCollector();
  const image = node({ currentSrc: "https://example.com/current.webp", src: "/fallback.jpg", "data-src": "/lazy.png", srcset: "/small.jpg 400w, /large.jpg 1200w", naturalWidth: 1200, naturalHeight: 800, alt: "示例图片" });
  const source = node({ srcset: "/picture-1.webp 1x, /picture-2.webp 2x" });
  const meta = node({ content: "/social.jpg" });
  const link = node({ href: "https://example.com/preload.avif", imagesrcset: "" });
  const styled = { style: { backgroundImage: "url('/background.gif')" } };
  const selectorMap = new Map([
    ["img", [image]],
    ["source", [source]],
    ["meta[property='og:image'],meta[property='og:image:url'],meta[name='twitter:image'],meta[name='twitter:image:src']", [meta]],
    ["link[rel~='preload'][as='image'],link[rel~='image_src']", [link]],
    ["body *", [styled]],
  ]);
  const document = { baseURI: "https://example.com/gallery/page", querySelectorAll(selector) { return selectorMap.get(selector) || []; }, defaultView: { getComputedStyle(element) { return element.style; } } };
  const performance = { getEntriesByType() { return [{ name: "https://cdn.example.com/network.png", initiatorType: "img" }]; } };
  const images = collector.scanDocument(document, performance, "https://example.com/gallery/page");
  const urls = new Set(Array.from(images, (item) => item.url));
  for (const expected of ["https://example.com/current.webp", "https://example.com/lazy.png", "https://example.com/small.jpg", "https://example.com/large.jpg", "https://example.com/picture-2.webp", "https://example.com/social.jpg", "https://example.com/background.gif", "https://cdn.example.com/network.png"]) assert.ok(urls.has(expected), expected);
  assert.equal(images.find((item) => item.url.endsWith("current.webp")).width, 1200);
});

test("Side Panel 包含实时状态、筛选、清空、图库、下载与截图操作", () => {
  for (const id of ["liveBadge", "pageTitle", "search", "format", "minWidth", "gallery", "clearSelection", "clearResults", "downloadSelected", "captureVisible", "captureRegion"]) assert.match(sidepanelHtml, new RegExp(`id=["']${id}["']`));
});
