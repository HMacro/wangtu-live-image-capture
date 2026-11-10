import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extension = resolve(root, "dist-extension");
const manifest = JSON.parse(await readFile(resolve(extension, "manifest.json"), "utf8"));

assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.side_panel?.default_path, "sidepanel.html");
assert.ok(manifest.permissions.includes("sidePanel"));
assert.ok(manifest.permissions.includes("downloads"));
assert.deepEqual(manifest.host_permissions, ["<all_urls>"]);

const files = ["collector.js", "content.js", "service-worker.js", "sidepanel.html", "sidepanel.css", "capture.css", "sidepanel.js"];
files.push("icons/icon16.png", "icons/icon32.png", "icons/icon48.png", "icons/icon128.png");
for (const file of files) await access(resolve(extension, file));
for (const file of files.filter((file) => file.endsWith(".js"))) {
  const result = spawnSync(process.execPath, ["--check", resolve(extension, file)], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || `${file} failed syntax validation`);
}

for (const size of [16, 32, 48, 128]) {
  const png = await readFile(resolve(extension, `icons/icon${size}.png`));
  assert.deepEqual(Array.from(png.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), size);
  assert.equal(png.readUInt32BE(20), size);
}

console.log("Manifest V3 extension structure and scripts are valid");
