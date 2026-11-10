const stateByTab = new Map();

function tabFrames(tabId) {
  if (!stateByTab.has(tabId)) stateByTab.set(tabId, new Map());
  return stateByTab.get(tabId);
}

function mergeTab(tabId) {
  const frames = stateByTab.get(tabId) || new Map();
  const images = new Map();
  let page = null;
  let updatedAt = 0;

  for (const frame of frames.values()) {
    if (!page || frame.page?.isTop) page = frame.page;
    updatedAt = Math.max(updatedAt, frame.updatedAt || 0);
    for (const item of frame.images || []) {
      if (!item?.url) continue;
      const previous = images.get(item.url);
      if (!previous || (item.width || 0) * (item.height || 0) > (previous.width || 0) * (previous.height || 0)) {
        images.set(item.url, item);
      }
    }
  }

  return {
    tabId,
    page,
    images: Array.from(images.values()).sort((a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0)),
    frameCount: frames.size,
    updatedAt,
  };
}

function broadcast(tabId) {
  chrome.runtime.sendMessage({ type: "TAB_STATE_UPDATED", tabId, state: mergeTab(tabId) }).catch(() => {});
}

function safeFileName(value) {
  return String(value || "image").replace(/[\\/:*?"<>|\x00-\x1f]/g, "-").slice(0, 140) || "image";
}

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "FRAME_SNAPSHOT" && sender.tab?.id != null) {
    const frames = tabFrames(sender.tab.id);
    frames.set(sender.frameId ?? 0, {
      page: message.page,
      images: Array.isArray(message.images) ? message.images.slice(0, 600) : [],
      updatedAt: Date.now(),
    });
    broadcast(sender.tab.id);
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "GET_TAB_STATE") {
    sendResponse(mergeTab(Number(message.tabId)));
    return false;
  }

  if (message?.type === "RESCAN_TAB") {
    chrome.tabs.sendMessage(Number(message.tabId), { type: "RESCAN_FRAME" }, () => {
      void chrome.runtime.lastError;
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message?.type === "CLEAR_TAB_STATE") {
    const tabId = Number(message.tabId);
    stateByTab.delete(tabId);
    broadcast(tabId);
    chrome.tabs.sendMessage(tabId, { type: "CLEAR_CAPTURED_IMAGES" }, () => {
      void chrome.runtime.lastError;
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message?.type === "DOWNLOAD_IMAGES") {
    (async () => {
      const items = Array.isArray(message.items) ? message.items.slice(0, 100) : [];
      let success = 0;
      const errors = [];
      for (const item of items) {
        if (!item?.url || /^(?:blob:|data:)/i.test(item.url)) {
          errors.push(item?.fileName || item?.url || "未知资源");
          continue;
        }
        try {
          await chrome.downloads.download({
            url: item.url,
            filename: `网图下载/${safeFileName(item.fileName)}`,
            conflictAction: "uniquify",
            saveAs: false,
          });
          success += 1;
        } catch {
          errors.push(item.fileName || item.url);
        }
      }
      sendResponse({ ok: errors.length === 0, success, errors });
    })();
    return true;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => stateByTab.delete(tabId));
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading" || changeInfo.url) {
    stateByTab.delete(tabId);
    broadcast(tabId);
  }
});
