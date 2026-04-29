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

/**
 * 默认示例文件内容
 */
export const DEMO_FILE = `<mxfile pages="1">
  <diagram id="demo">
    <mxGraphModel>
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;
