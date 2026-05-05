/**
 * draw.io 运行时配置与覆写
 *
 * draw.io 的全局配置分为三个层面：
 * 1. 全局变量 — 在 draw.io 脚本加载前设置，控制资源加载路径等
 * 2. urlParams  — draw.io 读取的 URL 参数对象，控制编辑器行为
 * 3. 原型覆写  — 在 app.min.js 加载后、实例化前覆写，禁用不需要的功能
 *
 * 本文件集中管理所有针对 draw.io 的运行时修改，便于维护和查阅。
 */

// ─── 1. 全局变量（脚本加载前设置） ───────────────────────────

/**
 * 设置 draw.io CDN 资源路径
 *
 * draw.io 通过一系列全局变量来定位其资源文件（图片、模板、样式等）。
 * 当从第三方页面嵌入时，必须手动将这些变量指向 CDN，
 * 否则 draw.io 会尝试从当前域名加载相对路径导致 404。
 */
export function setupGlobals(cdnBase: string): void {
  const w = window as any;

  w.mxIsElectron = false; // 非 Electron 环境，禁用桌面端特有逻辑

  // ── mxGraph 核心资源路径 ──
  w.mxBasePath = `${cdnBase}mxgraph`; // mxGraph 根路径（js/css/images 基目录）
  w.mxImageBasePath = `${cdnBase}mxgraph/images`; // mxGraph 图标（工具栏、光标等）
  w.RESOURCES_PATH = `${cdnBase}resources`; // 国际化资源文件目录
  w.RESOURCE_BASE = `${cdnBase}resources/dia`; // 国际化资源基础路径前缀

  // ── draw.io 编辑器资源路径 ──
  w.STENCIL_PATH = `${cdnBase}stencils`; // 图形模板（stencil）文件目录
  w.SHAPES_PATH = `${cdnBase}shapes`; // 扩展形状定义目录
  w.PLUGINS_BASE_PATH = cdnBase; // 插件加载基路径
  w.DRAW_MATH_URL = // MathJax 公式渲染脚本地址
    "https://cdn.jsdelivr.net/gh/jgraph/drawio/src/main/webapp/math/MathJax.js";

  // ── 样式加载控制 ──
  w.mxLoadStylesheets = false; // 禁止 mxClient 自动加载 CSS，改由我们手动引入（避免路径错误）
}

// ─── 2. urlParams（draw.io 行为参数） ─────────────────────────

/**
 * 设置 draw.io urlParams
 *
 * draw.io 在初始化时读取 `window.urlParams` 对象来决定编辑器行为。
 * 这等价于在 URL 中传入 `?key=value` 参数，但通过 JS 对象设置更可控。
 *
 * 完整参数列表参考: https://www.drawio.com/doc/faq/supported-url-parameters
 */
export function setupUrlParams(lang?: string): void {
  const w = window as any;
  w.urlParams = w.urlParams || {};

  w.urlParams["math"] = "0"; // 禁用 MathJax 公式渲染，减少加载时间
  w.urlParams["stealth"] = "1"; // 隐藏云存储入口（Google Drive、OneDrive、Dropbox 等）
  w.urlParams["chrome"] = "0"; // 隐藏 draw.io 最外层 chrome（标题栏 + 菜单栏容器）
  w.urlParams["demo"] = "1"; // 启动时自动调用 createFile() 创建空白文件，跳过存储选择/文件名对话框

  if (lang) {
    w.urlParams["lang"] = lang; // 界面语言（en / zh / ja 等），影响菜单和提示文本
  }
}

// ─── 3. 原型覆写（app.min.js 加载后） ────────────────────────

/**
 * 覆写 draw.io 原型方法
 *
 * 在 app.min.js 加载完成后、App 实例化之前调用。
 * 通过覆写原型方法来禁用与 Yjs 实时持久化冲突的功能。
 *
 * ⚠️ 必须在 app.min.js onload 后立即调用，此时类已定义但尚未实例化。
 */
export function applyPrototypeOverrides(): void {
  const w = window as any;

  // App.prototype.onBeforeUnload
  // 原始行为: 页面关闭/刷新时检查 isModified()，弹出 "All changes will be lost" 确认框
  // 覆写原因: 数据由 Yjs 通过 y-websocket 实时同步到服务端，无需 draw.io 的离开警告
  if (w.App?.prototype) {
    w.App.prototype.onBeforeUnload = function () {};
  }

  // DrawioFile.prototype.addUnsavedStatus
  // 原始行为: 在状态栏显示 "Unsaved changes. Click here to save." 警告
  // 覆写原因: 同上，Yjs 实时持久化，不存在 "未保存" 的概念
  if (w.DrawioFile?.prototype) {
    w.DrawioFile.prototype.addUnsavedStatus = function () {};
  }
}
