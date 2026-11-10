import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import worker from "../worker/index.js";

const originalFetch = globalThis.fetch;

function upstream(body, init = {}, url = "https://example.test/") {
  const response = new Response(body, init);
  Object.defineProperty(response, "url", { value: url });
  return response;
}

async function withFetch(mock, run) {
  globalThis.fetch = mock;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function scanRequest(url) {
  return new Request("https://workbench.test/api/scan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
}

test("主页包含完整工作台和可解析的客户端脚本", async () => {
  const response = await worker.fetch(new Request("https://workbench.test/"));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  const html = await response.text();
  assert.match(html, /把网页里的图片/);
  assert.match(html, /id="downloadZip"/);
  assert.match(html, /单张下载/);
  assert.match(html, /最近抓取/);
  assert.match(html, /id="scanForm"[^>]+onsubmit="return false"/);
  assert.match(html, /id="scanButton"[^>]+type="button"/);
  assert.doesNotMatch(html, /[\x00-\x08\x0b\x0c\x0e-\x1f]/, "HTML 不应包含会被浏览器替换的控制字符");
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1);
  assert.doesNotThrow(() => new Function(scripts[0][1]));
});

test("客户端批量下载器生成结构完整的 ZIP 文件", async () => {
  const html = await (await worker.fetch(new Request("https://workbench.test/"))).text();
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
  const elements = new Map();
  const makeElement = (id = "") => ({
    id,
    value: "",
    tagName: "DIV",
    disabled: false,
    innerHTML: "",
    textContent: "",
    dataset: {},
    classList: { add() {}, remove() {}, contains() { return false; } },
    addEventListener() {},
    appendChild() {},
    remove() {},
    click() {},
  });
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement(id));
      return elements.get(id);
    },
    createElement: () => makeElement(),
    body: makeElement("body"),
  };
  const requested = [];
  const context = vm.createContext({
    document,
    window: { open() {} },
    localStorage: { getItem() { return null; }, setItem() {} },
    fetch: async (url) => {
      requested.push(String(url));
      return new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { "content-type": "image/png" } });
    },
    Response,
    Blob,
    TextEncoder,
    Uint8Array,
    Set,
    URL,
    encodeURIComponent,
    decodeURIComponent,
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(script, context, { filename: "client.js" });
  const blob = await context.makeZip([{ name: "pixel.png", url: "https://cdn.example.test/pixel.png" }]);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  assert.deepEqual([...bytes.slice(-22, -18)], [0x50, 0x4b, 0x05, 0x06]);
  assert.equal(requested.length, 1);
  assert.match(requested[0], /^\/api\/image\?url=/);
});

test("未知路径返回 404", async () => {
  const response = await worker.fetch(new Request("https://workbench.test/missing"));
  assert.equal(response.status, 404);
});

test("扫描接口解析普通、懒加载、srcset、社交卡片和 CSS 图片", async () => {
  const html = `<!doctype html><html><head>
    <title>示例图库</title>
    <base href="/assets/">
    <meta property="og:image" content="//cdn.example.test/cover.jpg">
    <link rel="preload" as="image" href="preload.avif" imagesrcset="pre-1.png 1x, pre-2.png 2x">
    <style>.hero{background-image:url('bg.gif')}</style>
  </head><body>
    <img src="hero.jpg" data-src="/lazy.png" srcset="small.jpg 400w, large.jpg 1200w">
    <picture><source srcset="a.webp 1x, b.webp 2x"></picture>
    <img src="hero.jpg"><img src="data:image/png;base64,AAAA">
    <img src="http://127.0.0.1/private.png">
  </body></html>`;

  await withFetch(async () => upstream(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  }, "https://example.test/gallery/page"), async () => {
    const response = await worker.fetch(scanRequest("https://example.test/gallery/page"));
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.title, "示例图库");
    assert.deepEqual(data.images, [
      "https://example.test/assets/hero.jpg",
      "https://example.test/lazy.png",
      "https://example.test/assets/small.jpg",
      "https://example.test/assets/large.jpg",
      "https://example.test/assets/a.webp",
      "https://example.test/assets/b.webp",
      "https://cdn.example.test/cover.jpg",
      "https://example.test/assets/preload.avif",
      "https://example.test/assets/pre-1.png",
      "https://example.test/assets/pre-2.png",
      "https://example.test/assets/bg.gif",
    ]);
  });
});

test("扫描请求使用普通浏览器标识，避免网站返回反爬跳转壳", async () => {
  let requestHeaders;
  await withFetch(async (_url, init) => {
    requestHeaders = init.headers;
    return upstream("<title>ok</title><img src='/ok.png'>", {
      headers: { "content-type": "text/html" },
    }, "https://example.test/");
  }, async () => {
    const response = await worker.fetch(scanRequest("https://example.test/"));
    assert.equal(response.status, 200);
  });
  assert.match(requestHeaders["user-agent"], /Chrome\//);
  assert.doesNotMatch(requestHeaders["user-agent"], /WangtuImageWorkbench/);
  assert.match(requestHeaders["accept-language"], /zh-CN/);
});

test("扫描结果去重且最多返回 300 张图片", async () => {
  const tags = Array.from({ length: 305 }, (_, i) => `<img src="/image-${i}.jpg">`).join("");
  await withFetch(async () => upstream(tags + '<img src="/image-1.jpg">', {
    headers: { "content-type": "text/html" },
  }, "https://example.test/list"), async () => {
    const response = await worker.fetch(scanRequest("https://example.test/list"));
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.images.length, 300);
    assert.equal(new Set(data.images).size, 300);
  });
});

test("危险或不支持的目标地址会在发起网络请求前被拦截", async () => {
  let calls = 0;
  await withFetch(async () => { calls += 1; throw new Error("不应调用"); }, async () => {
    for (const url of [
      "ftp://example.com/file",
      "http://localhost/admin",
      "http://127.0.0.1/admin",
      "http://10.1.2.3/admin",
      "http://172.16.0.5/admin",
      "http://192.168.1.2/admin",
      "https://user:pass@example.com/private",
    ]) {
      const response = await worker.fetch(scanRequest(url));
      assert.equal(response.status, 400, url);
    }
    assert.equal(calls, 0);
  });
});

test("扫描接口正确报告上游 HTTP、内容类型和体积错误", async (t) => {
  await t.test("HTTP 错误", async () => withFetch(async () => upstream("no", { status: 403 }, "https://example.test/"), async () => {
    const response = await worker.fetch(scanRequest("https://example.test/"));
    assert.equal(response.status, 422);
    assert.match((await response.json()).error, /403/);
  }));
  await t.test("非 HTML", async () => withFetch(async () => upstream("{}", { headers: { "content-type": "application/json" } }, "https://example.test/"), async () => {
    const response = await worker.fetch(scanRequest("https://example.test/"));
    assert.equal(response.status, 422);
    assert.match((await response.json()).error, /HTML/);
  }));
  await t.test("HTML 超过 5 MB", async () => withFetch(async () => upstream("small", { headers: { "content-type": "text/html", "content-length": String(6 * 1024 * 1024) } }, "https://example.test/"), async () => {
    const response = await worker.fetch(scanRequest("https://example.test/"));
    assert.equal(response.status, 422);
    assert.match((await response.json()).error, /过大/);
  }));
});

test("图片代理返回图片内容，并为单张下载设置安全文件名", async () => {
  await withFetch(async () => upstream(new Uint8Array([137, 80, 78, 71]), {
    headers: { "content-type": "image/png", "content-length": "4" },
  }, "https://cdn.example.test/photos/a%20b.png"), async () => {
    const url = "https://workbench.test/api/image?download=1&url=" + encodeURIComponent("https://cdn.example.test/photos/a%20b.png");
    const response = await worker.fetch(new Request(url));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.match(response.headers.get("content-disposition"), /a%20b\.png/);
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [137, 80, 78, 71]);
  });
});

test("图片代理拒绝非图片、超大图片和重定向到私网的资源", async (t) => {
  await t.test("非图片", async () => withFetch(async () => upstream("html", { headers: { "content-type": "text/html" } }, "https://cdn.example.test/file"), async () => {
    const response = await worker.fetch(new Request("https://workbench.test/api/image?url=" + encodeURIComponent("https://cdn.example.test/file")));
    assert.equal(response.status, 415);
  }));
  await t.test("超过 25 MB", async () => withFetch(async () => upstream("x", { headers: { "content-type": "image/jpeg", "content-length": String(26 * 1024 * 1024) } }, "https://cdn.example.test/huge.jpg"), async () => {
    const response = await worker.fetch(new Request("https://workbench.test/api/image?url=" + encodeURIComponent("https://cdn.example.test/huge.jpg")));
    assert.equal(response.status, 413);
  }));
  await t.test("重定向到私网", async () => withFetch(async () => upstream("x", { headers: { "content-type": "image/png" } }, "http://127.0.0.1/secret.png"), async () => {
    const response = await worker.fetch(new Request("https://workbench.test/api/image?url=" + encodeURIComponent("https://cdn.example.test/start.png")));
    assert.equal(response.status, 422);
  }));
});
