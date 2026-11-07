
# diagram 标签属性的设置位置和作用

## 必需属性（draw.io 内部自动设置）

| 属性 | 设置位置 | 作用 | 需要同步吗？ |
|------|----------|------|-------------|
| id | draw.js 内部 | diagram 的唯一标识符，用于多页管理 | ✅ 是，但单独处理 |
| name | draw.js 内部 | 页面名称，显示在页面标签上 | ✅ 是，但单独处理 |

## 可通过 Format Panel 设置的全局属性

### 1. Background（背景）
**设置位置：** Format Panel → Diagram Tab → "Set a colored background" 或 "Use a background image"
**作用：** 设置页面背景颜色或背景图片
**示例值：** "#ffffff", "url(https://example.com/bg.png)"
**需要同步吗？** ✅ 推荐同步（你的场景中需要）

### 2. Grid Size（网格大小）
**设置位置：** Format Panel → View settings → "diagram editor grid"
**作用：** 控制绘图区域的网格密度，帮助对齐形状和连接器
**注意：** 网格不会包含在打印或导出的结果中，仅用于编辑对齐
**需要同步吗？** ❌ 不需要（纯编辑辅助，不出现在最终输出）

### 3. Page View（页面视图）
**设置位置：** Format Panel → View settings → "page view" checkbox
**作用：** 显示或隐藏页面边缘框
**注意：** 页面边缘框本身不体现在 XML 输出中
**需要同步吗？** ❌ 不需要

### 4. Shadow（阴影）
**设置位置：** Format Panel → View settings → "Apply a shadow"
**作用：** 对所有元素添加阴影效果
**需要同步吗？** ❌ 不需要（阴影是元素级的，不是 diagram 级的）

## 可通过 File → Page Setup 设置的属性

### 5. Page Size（页面尺寸）
**设置位置：** File → Page Setup 或 Format Panel → Paper Size
**作用：** 设置页面宽度/高度
**对应 XML 属性：** pageWidth, pageHeight
**需要同步吗？** ✅ 如需要同步

### 6. Page Scale（页面缩放）
**设置位置：** File → Page Setup 或 Format Panel → Scale
**作用：** 设置页面缩放比例，影响打印或导出到 PDF 时的大小
**对应 XML 属性：** pageScale, printScale
**需要同步吗？** ✅ 如需要同步

### 7. Paper Size（纸张尺寸）
**设置位置：** Format Panel → Paper Size dropdown
**作用：** 预设纸张尺寸（A4, Letter 等）
**对应 XML 属性：** 自动转换为 pageWidth, pageHeight
**需要同步吗？** ✅ 如需要同步

## 其他属性

### 8. Connections（连接）
**设置位置：** 用户在 Diagram 中绘制连接时自动创建
**作用：** 存储连接关系
**注意：** 连接信息保存在 mxGraphModel 的 <mxCell> 元素中，不是 diagram 属性
**需要同步吗？** ❌ 不需要（已在 mxGraphModel 中同步）

### 9. AutoConnect（自动连接）
**设置位置：** Format Panel → Options → "Hide or display the four direction arrows" 相关选项
**作用：** 控制形状间的自动连接功能
**需要同步吗？** ❌ 不需要（UI 行为配置）

### 10-15. 其他属性（pageCount, pageVisible, pageMargin 等）
**设置位置：** draw.js 内部多页逻辑
**作用：** 内部多页管理
**需要同步吗？** ❌ 不需要（除非你的场景明确需要）

## 总结

**只需要同步的属性：**

| 属性 | 用途 | 需要同步吗 |
|------|------|-----------|
| background | 背景颜色/图片 | ✅ 推荐（你的需求） |
| pageWidth, pageHeight | 页面尺寸 | ✅ 按需（Page Setup 设置） |
| pageScale, printScale | 页面缩放 | ✅ 按需（影响打印/导出） |

**不需要同步的属性：**
- gridSize, gridColor（编辑辅助，不出现在输出）
- connections, connectLinks（已在 mxGraphModel 中）
- autoConnect, pageVisible, pageCount 等（内部 UI 行为）

**结论：**
大部分 diagram 属性是 draw.io 内部使用或 UI 配置，只有 background 和页面尺寸/缩放这些是真正需要跨用户同步的显示设置。
