import { defineConfig } from "vitepress";

export default defineConfig({
  title: "y-mxgraph",
  description: "Yjs binding for draw.io (mxGraph)",
  base: "/y-mxgraph/",
  locales: {
    root: {
      label: "中文",
      lang: "zh-CN",
      themeConfig: {
        nav: [
          { text: "指南", link: "/guide/getting-started" },
          { text: "API", link: "/api/" },
          { text: "Demo", link: "/demo/", target: "_blank" },
          { text: "GitHub", link: "https://github.com/mizuka-wu/y-mxgraph" },
        ],
        sidebar: {
          "/guide/": [
            {
              text: "指南",
              items: [
                { text: "快速开始", link: "/guide/getting-started" },
                { text: "使用 Provider", link: "/guide/providers" },
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
      },
    },
    en: {
      label: "English",
      lang: "en-US",
      link: "/en/",
      themeConfig: {
        nav: [
          { text: "Guide", link: "/en/guide/getting-started" },
          { text: "API", link: "/en/api/" },
          { text: "Demo", link: "/y-mxgraph/demo/", target: "_blank" },
          { text: "GitHub", link: "https://github.com/mizuka-wu/y-mxgraph" },
        ],
        sidebar: {
          "/en/guide/": [
            {
              text: "Guide",
              items: [
                { text: "Getting Started", link: "/en/guide/getting-started" },
                { text: "Using Providers", link: "/en/guide/providers" },
                { text: "Architecture", link: "/en/guide/architecture" },
                {
                  text: "Migration Guide",
                  link: "/en/guide/implementation-diff",
                },
              ],
            },
          ],
          "/en/api/": [
            {
              text: "API Reference",
              items: [
                { text: "Overview", link: "/en/api/" },
                { text: "Binding", link: "/en/api/binding" },
                { text: "xml2doc", link: "/en/api/xml2doc" },
                { text: "doc2xml", link: "/en/api/doc2xml" },
                { text: "LOCAL_ORIGIN", link: "/en/api/local-origin" },
              ],
            },
          ],
        },
      },
    },
  },
  themeConfig: {
    socialLinks: [
      { icon: "github", link: "https://github.com/mizuka-wu/y-mxgraph" },
    ],
    footer: {
      message: "Released under the MIT License.",
    },
  },
});
