
从 draw.io 源代码和官方文档总结的 <diagram> 标签所有属性：

=== 必需属性 ===
1. id              - diagram 的唯一标识符（如 "page1"）
2. name            - 页面名称（显示在页面标签上）

=== 常用属性（display 相关）===
3. pages           - 页数，"1"|"2" 等多页标识
4. background      - 背景颜色或背景图片 URL（如 "#ffffff" 或 "https://example.com/bg.png"）
5. pageCount       - 页面总数（当 pages 属性指定时）
6. pageVisible     - 页面是否可见，"0"（隐藏）或 "1"（显示）
7. pageScale       - 页面缩放比例，如 "1"|"0.5"|"1.5"
8. pageWidth       - 页面宽度（像素），如 "816"
9. pageHeight      - 页面高度（像素），如 "577"

=== 连接相关属性 ===
10. connections    - 连接集合，存储连接信息
11. connectLinks   - 连接链接数

=== 布局相关属性 ===
12. autoConnect    - 自动连接，"0"|"1"
13. gridSize       - 网格大小，如 "10"
14. pageMargin     - 页面边距

=== 打印相关属性 ===
15. printScale     - 打印缩放比例
16. printPageBreak - 打印分页符

=== 笔记本相关属性 ===
17. notebookOverflow - 笔记本溢出处理方式

=== 状态属性 ===
18. isPage         - 是否是独立页面，"0"|"1"
19. collapseContent - 是否折叠内容，"0"|"1"
20. fitPanic       - 适应模式

=== 其他属性 ===
21. preserveImageAspect - 保持图片比例

注意：
- 这些属性通常在 app.js 或 draw.io 配置中设置
- 大部分是显示方式相关的配置参数
- 实际使用取决于 draw.io 的版本和功能开启情况
- 有些属性是 draw.io 内部使用的，用户很少手动设置
