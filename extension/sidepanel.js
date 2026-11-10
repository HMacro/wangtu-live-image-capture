"use strict";

const state = {
  tabId: null,
  page: null,
  images: [],
  selected: new Set(),
};

const elements = {
  pageTitle: document.getElementById("pageTitle"),
  pageUrl: document.getElementById("pageUrl"),
  liveBadge: document.getElementById("liveBadge"),
  rescan: document.getElementById("rescan"),
  search: document.getElementById("search"),
  format: document.getElementById("format"),
  minWidth: document.getElementById("minWidth"),
  visibleCount: document.getElementById("visibleCount"),
  selectedCount: document.getElementById("selectedCount"),
  footerSelected: document.getElementById("footerSelected"),
  selectVisible: document.getElementById("selectVisible"),
  clearSelection: document.getElementById("clearSelection"),
  clearResults: document.getElementById("clearResults"),
  downloadSelected: document.getElementById("downloadSelected"),
  captureVisible: document.getElementById("captureVisible"),
  captureRegion: document.getElementById("captureRegion"),
  status: document.getElementById("status"),
  gallery: document.getElementById("gallery"),
  toast: document.getElementById("toast"),
};

function send(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(response);
    });
  });
}

function sendToTab(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(response);
    });
  });
}

function captureVisibleTab(windowId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(windowId, { format: "png" }, (dataUrl) => {
      if (chrome.runtime.lastError || !dataUrl) reject(new Error(chrome.runtime.lastError?.message || "截图失败"));
      else resolve(dataUrl);
    });
  });
}

function startDownload(url, filename) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download({ url, filename, conflictAction: "uniquify", saveAs: false }, (downloadId) => {
      if (chrome.runtime.lastError || downloadId == null) reject(new Error(chrome.runtime.lastError?.message || "保存失败"));
      else resolve(downloadId);
    });
  });
}

function screenshotName(kind) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `网图下载/截图-${kind}-${stamp}.png`;
}

function setCaptureBusy(busy) {
  elements.captureVisible.disabled = busy;
  elements.captureRegion.disabled = busy;
}

function filteredImages() {
  const query = elements.search.value.trim().toLowerCase();
  const format = elements.format.value;
  const minWidth = Number(elements.minWidth.value);
  return state.images.filter((item) => {
    const text = `${item.fileName || ""} ${item.url || ""} ${item.alt || ""}`.toLowerCase();
    return (!query || text.includes(query))
      && (format === "all" || item.type === format)
      && (!minWidth || Number(item.width || 0) >= minWidth);
  });
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => elements.toast.classList.remove("show"), 2600);
}

async function saveVisibleScreenshot() {
  const tab = await activeTab();
  if (!tab?.windowId || !tab.url?.startsWith("http")) return showToast("当前页面不支持截图");
  setCaptureBusy(true);
  elements.status.textContent = "正在截取当前网页画面…";
  try {
    const dataUrl = await captureVisibleTab(tab.windowId);
    await startDownload(dataUrl, screenshotName("全屏"));
    showToast("全屏截图已保存");
  } catch (error) {
    showToast(error.message || "截图保存失败");
  } finally {
    setCaptureBusy(false);
    render();
  }
}

async function beginRegionCapture() {
  const tab = await activeTab();
  if (!tab?.id || !tab.url?.startsWith("http")) return showToast("当前页面不支持自由截图");
  const result = await sendToTab(tab.id, { type: "START_REGION_CAPTURE" });
  if (!result?.ok) return showToast("请刷新网页后再试");
  elements.status.textContent = "请在左侧网页拖拽选择截图区域，按 Esc 取消";
  showToast("请在网页中拖拽选择区域");
}

async function saveRegionScreenshot(message, sender) {
  if (sender?.tab?.id !== state.tabId || !message?.rect || !message?.viewport) return;
  const tab = await chrome.tabs.get(state.tabId);
  setCaptureBusy(true);
  elements.status.textContent = "正在裁剪并保存截图…";
  try {
    const dataUrl = await captureVisibleTab(tab.windowId);
    const sourceBlob = await (await fetch(dataUrl)).blob();
    const bitmap = await createImageBitmap(sourceBlob);
    const scaleX = bitmap.width / message.viewport.width;
    const scaleY = bitmap.height / message.viewport.height;
    const sourceX = Math.max(0, Math.round(message.rect.x * scaleX));
    const sourceY = Math.max(0, Math.round(message.rect.y * scaleY));
    const sourceWidth = Math.min(bitmap.width - sourceX, Math.max(1, Math.round(message.rect.width * scaleX)));
    const sourceHeight = Math.min(bitmap.height - sourceY, Math.max(1, Math.round(message.rect.height * scaleY)));
    const canvas = document.createElement("canvas");
    canvas.width = sourceWidth;
    canvas.height = sourceHeight;
    canvas.getContext("2d").drawImage(bitmap, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);
    bitmap.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("无法生成截图文件");
    const blobUrl = URL.createObjectURL(blob);
    try {
      await startDownload(blobUrl, screenshotName("自由"));
    } finally {
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
    }
    showToast(`自由截图已保存 · ${sourceWidth} × ${sourceHeight}`);
  } catch (error) {
    showToast(error.message || "自由截图失败");
  } finally {
    setCaptureBusy(false);
    render();
  }
}

function shortUrl(value) {
  try {
    const url = new URL(value);
    return url.hostname + url.pathname;
  } catch {
    return value || "";
  }
}

function makeButton(label, action) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.dataset.action = action;
  return button;
}

function renderCard(item) {
  const card = document.createElement("article");
  card.className = `image-card${state.selected.has(item.url) ? " selected" : ""}`;
  card.dataset.url = item.url;

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "check";
  checkbox.checked = state.selected.has(item.url);
  checkbox.setAttribute("aria-label", `选择 ${item.fileName || "图片"}`);
  card.appendChild(checkbox);

  const type = document.createElement("span");
  type.className = "type";
  type.textContent = item.type || "IMG";
  card.appendChild(type);

  const thumb = document.createElement("div");
  thumb.className = "thumb";
  const image = document.createElement("img");
  image.loading = "lazy";
  image.alt = item.alt || "";
  image.referrerPolicy = "no-referrer";
  image.src = item.url;
  image.addEventListener("error", () => {
    image.remove();
    const message = document.createElement("span");
    message.className = "broken";
    message.textContent = "预览受防盗链保护\n仍可尝试下载";
    thumb.appendChild(message);
  }, { once: true });
  thumb.appendChild(image);
  card.appendChild(thumb);

  const copy = document.createElement("div");
  copy.className = "card-copy";
  const name = document.createElement("div");
  name.className = "filename";
  name.title = item.fileName || item.url;
  name.textContent = item.fileName || "未命名图片";
  copy.appendChild(name);
  const dimensions = document.createElement("div");
  dimensions.className = "dimensions";
  dimensions.textContent = item.width ? `${item.width} × ${item.height || "?"} px · ${item.source || "DOM"}` : `尺寸未知 · ${item.source || "DOM"}`;
  copy.appendChild(dimensions);
  const actions = document.createElement("div");
  actions.className = "card-actions";
  actions.append(makeButton("查看", "open"), makeButton("下载", "download"));
  copy.appendChild(actions);
  card.appendChild(copy);
  return card;
}

function render() {
  const visible = filteredImages();
  const available = new Set(state.images.map((item) => item.url));
  for (const url of state.selected) if (!available.has(url)) state.selected.delete(url);

  elements.pageTitle.textContent = state.page?.title || "等待连接当前网页";
  elements.pageUrl.textContent = state.page?.url ? shortUrl(state.page.url) : "打开一个 HTTP 或 HTTPS 网站";
  elements.pageUrl.title = state.page?.url || "";
  elements.visibleCount.textContent = String(visible.length);
  elements.selectedCount.textContent = String(state.selected.size);
  elements.footerSelected.textContent = String(state.selected.size);
  elements.downloadSelected.disabled = state.selected.size === 0;
  elements.liveBadge.classList.toggle("off", !state.page);

  elements.gallery.replaceChildren();
  if (!visible.length) {
    elements.gallery.className = "empty";
    const art = document.createElement("div");
    art.className = "empty-art";
    art.textContent = state.images.length ? "⌕" : "⌁";
    const title = document.createElement("strong");
    title.textContent = state.images.length ? "没有符合筛选条件的图片" : "尚未发现图片";
    const note = document.createElement("span");
    note.textContent = state.page ? "浏览、点击或翻页后，面板将自动更新。" : "请切换到普通网页并刷新一次。";
    elements.gallery.append(art, title, note);
  } else {
    elements.gallery.className = "grid";
    const fragment = document.createDocumentFragment();
    for (const item of visible) fragment.appendChild(renderCard(item));
    elements.gallery.appendChild(fragment);
  }

  const frameText = state.page ? `已连接 · ${state.images.length} 张资源 · 页面变化会自动更新` : "无法连接此页面；浏览器内部页面不允许扩展读取";
  elements.status.className = `status${state.page ? "" : " error"}`;
  elements.status.textContent = frameText;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return null;
  state.tabId = tab.id;
  return tab;
}

async function loadState() {
  const tab = await activeTab();
  if (!tab) return render();
  const result = await send({ type: "GET_TAB_STATE", tabId: tab.id });
  state.page = result?.page || (tab.url?.startsWith("http") ? { url: tab.url, title: tab.title } : null);
  state.images = Array.isArray(result?.images) ? result.images : [];
  render();
  if (!result?.updatedAt) await send({ type: "RESCAN_TAB", tabId: tab.id });
}

async function download(items) {
  if (!items.length) return;
  elements.downloadSelected.disabled = true;
  elements.status.textContent = `正在创建 ${items.length} 个下载任务…`;
  const result = await send({ type: "DOWNLOAD_IMAGES", items });
  elements.downloadSelected.disabled = state.selected.size === 0;
  if (!result) return showToast("下载服务没有响应");
  if (result.success) showToast(`已开始下载 ${result.success} 张图片`);
  if (result.errors?.length) showToast(`${result.errors.length} 张图片受保护或已失效`);
  render();
}

elements.search.addEventListener("input", render);
elements.format.addEventListener("change", render);
elements.minWidth.addEventListener("change", render);
elements.selectVisible.addEventListener("click", () => {
  for (const item of filteredImages()) state.selected.add(item.url);
  render();
});
elements.clearSelection.addEventListener("click", () => {
  state.selected.clear();
  render();
});
elements.clearResults.addEventListener("click", async () => {
  if (!state.tabId) return;
  state.images = [];
  state.selected.clear();
  render();
  await send({ type: "CLEAR_TAB_STATE", tabId: state.tabId });
  showToast("已清空；网页中新出现的图片会继续加入");
});
elements.rescan.addEventListener("click", async () => {
  if (!state.tabId) return;
  elements.rescan.classList.add("spinning");
  await send({ type: "RESCAN_TAB", tabId: state.tabId });
  setTimeout(() => elements.rescan.classList.remove("spinning"), 500);
});
elements.gallery.addEventListener("change", (event) => {
  if (!event.target.classList.contains("check")) return;
  const url = event.target.closest(".image-card")?.dataset.url;
  if (!url) return;
  event.target.checked ? state.selected.add(url) : state.selected.delete(url);
  render();
});
elements.gallery.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const url = button.closest(".image-card")?.dataset.url;
  const item = state.images.find((candidate) => candidate.url === url);
  if (!item) return;
  if (button.dataset.action === "open") chrome.tabs.create({ url: item.url });
  else download([item]);
});
elements.downloadSelected.addEventListener("click", () => {
  download(state.images.filter((item) => state.selected.has(item.url)));
});
elements.captureVisible.addEventListener("click", saveVisibleScreenshot);
elements.captureRegion.addEventListener("click", beginRegionCapture);

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === "TAB_STATE_UPDATED" && message.tabId === state.tabId) {
    state.page = message.state?.page || state.page;
    state.images = Array.isArray(message.state?.images) ? message.state.images : [];
    render();
  } else if (message?.type === "REGION_SELECTED") {
    saveRegionScreenshot(message, sender);
  } else if (message?.type === "REGION_CAPTURE_CANCELLED" && sender?.tab?.id === state.tabId) {
    showToast("已取消自由截图");
    render();
  }
});

chrome.tabs.onActivated.addListener(() => loadState());
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId === state.tabId && (changeInfo.status === "complete" || changeInfo.url)) loadState();
});

loadState();
