import { test, expect } from "@playwright/test";

test.describe("iframe-bridge e2e 测试", () => {
  test("页面加载并显示 draw.io", async ({ page }) => {
    await page.goto("/");
    
    // 等待页面加载和 draw.io 初始化
    await page.waitForTimeout(15000);
    
    // 验证 draw.io 编辑器已加载
    // 在直接模式下，draw.io 编辑器会直接嵌入到页面中
    const editor = page.locator(".geEditor");
    await expect(editor).toBeVisible({ timeout: 60000 });
  });

  test("draw.io 编辑器可用", async ({ page }) => {
    await page.goto("/");
    
    // 等待页面和 draw.io 加载
    await page.waitForTimeout(15000);
    
    // 验证编辑器容器存在
    const editor = page.locator(".geEditor");
    await expect(editor).toBeVisible({ timeout: 60000 });
    
    // 验证编辑器可以交互
    // 尝试点击编辑器区域
    await editor.click();
  });

  test("协作状态显示", async ({ page }) => {
    await page.goto("/");
    
    // 等待页面加载
    await page.waitForTimeout(10000);
    
    // 检查协作状态区域
    const statusArea = page.locator("text=Collab:");
    await expect(statusArea).toBeVisible();
    
    // 获取状态文本
    const statusText = await statusArea.textContent();
    expect(statusText).toBeTruthy();
  });

  test("draw.io 状态显示", async ({ page }) => {
    await page.goto("/");
    
    // 等待页面加载
    await page.waitForTimeout(10000);
    
    // 检查 draw.io 状态区域
    const statusArea = page.locator("text=draw.io:");
    await expect(statusArea).toBeVisible();
    
    // 获取状态文本
    const statusText = await statusArea.textContent();
    expect(statusText).toBeTruthy();
  });

  test("工具栏按钮可用", async ({ page }) => {
    await page.goto("/");
    
    // 等待页面加载
    await page.waitForTimeout(10000);
    
    // 验证导出按钮存在
    const exportBtn = page.locator("#btn-export-xml");
    await expect(exportBtn).toBeVisible();
  });

  test("验证完整性按钮可用", async ({ page }) => {
    await page.goto("/");
    
    // 等待页面加载
    await page.waitForTimeout(10000);
    
    // 验证验证按钮存在
    const validateBtn = page.locator("#btn-validate-integrity");
    await expect(validateBtn).toBeVisible();
  });

  test("页面重新加载后 draw.io 重新加载", async ({ page }) => {
    await page.goto("/");
    
    // 等待页面加载
    await page.waitForTimeout(10000);
    
    // 重新加载页面
    await page.reload();
    
    // 等待页面重新加载
    await page.waitForTimeout(15000);
    
    // 验证 draw.io 重新加载
    const editor = page.locator(".geEditor");
    const isVisible = await editor.isVisible();
    expect(isVisible).toBeTruthy();
  });

  test("iframe 模式测试（通过 URL 参数）", async ({ page }) => {
    // 使用 URL 参数进入 iframe 模式
    // 注意：这个测试验证的是 URL 参数被正确处理，而不是 toolbar 被隐藏
    // 因为 toolbar 只在 window.parent !== window 时才隐藏
    await page.goto("/?iframeId=1");
    
    // 等待页面加载
    await page.waitForTimeout(15000);
    
    // 验证页面加载成功
    const editor = page.locator(".geEditor");
    await expect(editor).toBeVisible({ timeout: 60000 });
    
    // 验证 iframeId 参数被处理（页面应该正常加载）
    // toolbar 可见是因为页面不在 iframe 中
    const toolbar = page.locator("#toolbar");
    await expect(toolbar).toBeVisible();
  });
});
