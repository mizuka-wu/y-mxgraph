import { defineConfig } from "vitepress";

export default defineConfig({
  title: "y-mxgraph",
  description: "Yjs binding for draw.io (mxGraph)",
  base: "/y-mxgraph/",
  themeConfig: {
    nav: [
      { text: "指南", link: "/guide/getting-started" },
      { text: "API", link: "/api/" },
      { text: "Demo", link: "https://github.com/mizuka-wu/y-mxgraph" },
    ],
    sidebar: {
      "/guide/": [
        {
          text: "指南",
          items: [
            { text: "快速开始", link: "/guide/getting-started" },
            { text: "实现原理", link: "/guide/architecture" },
            { text: "与原版差异", link: "/guide/implementation-diff" },
          ],
        },
      ],
      "/api/": [
        {
          text: "API 参考",
          items: [
            { text: "概览", link: "/api/" },
            { text: "Binding 类", link: "/api/binding" },
            { text: "xml2doc", link: "/api/xml2doc" },
            { text: "doc2xml", link: "/api/doc2xml" },
            { text: "LOCAL_ORIGIN", link: "/api/local-origin" },
          ],
        },
      ],
    },
    socialLinks: [
      { icon: "github", link: "https://github.com/mizuka-wu/y-mxgraph" },
    ],
    footer: {
      message: "Released under the MIT License.",
    },
  },
});
