/**
 * draw.io 版本配置
 */
export const DRAWIO_VERSIONS: Record<string, string> = {
  latest:
    "https://cdn.jsdelivr.net/gh/jgraph/drawio/src/main/webapp/js/app.min.js",
  "29.7.9":
    "https://cdn.jsdelivr.net/gh/jgraph/drawio@29.7.9/src/main/webapp/js/app.min.js",
  "28.2.9":
    "https://cdn.jsdelivr.net/gh/jgraph/drawio@28.2.9/src/main/webapp/js/app.min.js",
  "27.1.6":
    "https://cdn.jsdelivr.net/gh/jgraph/drawio@27.1.6/src/main/webapp/js/app.min.js",
  "26.2.15":
    "https://cdn.jsdelivr.net/gh/jgraph/drawio@26.2.15/src/main/webapp/js/app.min.js",
};

/**
 * WebRTC 信令服务器配置
 */
export const SIGNALING_SERVERS = [];

/**
 * 默认房间名称
 */
export const DEFAULT_ROOM = "y-mxgraph-demo";

/** iframe.html 工具栏默认用户信息（与 iframe.html input 默认值一致） */
export const DEFAULT_IFRAME_USER = {
  account: "alice",
  name: "Alice",
  color: "#2563eb",
} as const;
