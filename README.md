# 网图实时捕获器

一个适用于 Edge / Chrome 的 Manifest V3 扩展。用户在正常浏览器标签页中登录和操作网站，扩展的右侧 Side Panel 会实时发现当前页面中的图片资源。

[隐私政策](PRIVACY.md) · [问题反馈](https://github.com/HMacro/wangtu-live-image-capture/issues)

扩展图标沿用项目视觉标识：深色圆角方块与荧光绿色右下箭头。

## 功能

- 登录状态完全保留在原网站和浏览器中
- 实时监听 DOM 变化、懒加载图片、`srcset`、CSS 背景图和图片网络资源
- 支持单页应用点击、翻页和无限滚动后的自动更新
- 聚合跨域 iframe 中可注入内容脚本的图片
- 按文件名、格式和宽度筛选
- 单张、勾选和批量下载到“网图下载”目录
- 下载受限时可保存当前网页全屏截图，或在网页中拖拽进行自由截图

## 安装到 Edge

1. 运行 `npm run build`。
2. 打开 `edge://extensions`。
3. 开启“开发人员模式”。
4. 点击“加载解压缩的扩展”，选择：

   `D:\Projects\wangtu-download-workbench\dist-extension`

5. 打开普通网站并登录，点击工具栏中的“网图实时捕获器”图标。右侧面板会自动打开并实时更新。

Chrome 的安装方法相同，扩展管理页为 `chrome://extensions`。

## 开发命令

```powershell
npm test
npm run build
npm run validate
```

修改扩展代码后重新运行 `npm run build`，然后在扩展管理页点击该扩展的“重新加载”。

## 截图功能

- “全屏截图”保存当前网页的可见区域，不包含浏览器地址栏和右侧面板。
- “自由截图”会在网页上显示选择遮罩；按住鼠标拖拽选区即可保存 PNG，按 `Esc` 取消。
- 截图文件统一保存在浏览器下载目录下的“网图下载”文件夹。

## 目录

- `extension/`：Manifest V3 扩展源代码
- `dist-extension/`：可加载到浏览器的构建目录
- `worker/`：保留的原网页版本
- `tests/extension.test.mjs`：扩展采集与结构测试

## 浏览器限制

浏览器内部页面（如 `edge://`、`chrome://`）、扩展商店、受 DRM 保护的画布内容，以及部分已失效的 `blob:` 地址无法捕获或下载。某些开启防盗链的网站可能只显示资源记录而不显示缩略图，但仍可尝试下载原始地址。
