import { test, expect } from "@playwright/test";

test.describe("Demo 页面基础 UI", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("页面标题正确", async ({ page }) => {
    await expect(page).toHaveTitle(/y-mxgraph Demo/);
  });

  test("toolbar 包含版本选择下拉框", async ({ page }) => {
    const select = page.locator("#version-select");
    await expect(select).toBeVisible();
    const options = await select.locator("option").allTextContents();
    expect(options.some((o) => o.includes("24.7.17"))).toBe(true);
  });

  test("toolbar 包含 Room 输入框，默认值正确", async ({ page }) => {
    const input = page.locator("#room-input");
    await expect(input).toBeVisible();
    await expect(input).toHaveValue("y-mxgraph-demo");
  });

  test("加载按钮可见", async ({ page }) => {
    await expect(page.locator("#load-btn")).toBeVisible();
  });

  test("初始状态连接按钮 disabled", async ({ page }) => {
    await expect(page.locator("#connect-btn")).toBeDisabled();
  });

  test("断开按钮初始不可见", async ({ page }) => {
    await expect(page.locator("#disconnect-btn")).toBeHidden();
  });

  test("loading overlay 初始可见", async ({ page }) => {
    await expect(page.locator("#loading-overlay")).toBeVisible();
  });

  test("draw.io 状态栏初始显示未加载", async ({ page }) => {
    await expect(page.locator("#drawio-status")).toHaveText("未加载");
  });

  test("协作状态初始显示未连接", async ({ page }) => {
    await expect(page.locator("#collab-status")).toHaveText("未连接");
  });
});

test.describe("版本切换 UI", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("选择自定义版本后自定义 URL 输入框出现", async ({ page }) => {
    const select = page.locator("#version-select");
    await select.selectOption("custom");
    await expect(page.locator("#custom-url-group")).toBeVisible();
  });

  test("选择非自定义版本后自定义 URL 输入框消失", async ({ page }) => {
    const select = page.locator("#version-select");
    await select.selectOption("custom");
    await select.selectOption("24.7.17");
    await expect(page.locator("#custom-url-group")).toBeHidden();
  });

  test("点击加载按钮触发 loading 状态", async ({ page }) => {
    await page.locator("#load-btn").click();
    await expect(page.locator("#drawio-status")).toHaveText("加载中...");
  });
});

test.describe("draw.io iframe 加载", () => {
  test("点击加载后 iframe 出现（等待 onload）", async ({ page }) => {
    await page.goto("/");
    await page.locator("#load-btn").click();

    const iframe = page.locator("#drawio-frame");
    await expect(iframe).toHaveAttribute("src", /draw.io|drawio|jsdelivr/);
  });

  test("iframe src 包含所选版本号", async ({ page }) => {
    await page.goto("/");
    const select = page.locator("#version-select");
    await select.selectOption("24.6.4");
    await page.locator("#load-btn").click();

    const iframe = page.locator("#drawio-frame");
    const src = await iframe.getAttribute("src");
    expect(src).toContain("24.6.4");
  });
});

test.describe("Room 参数", () => {
  test("URL 中携带 room 参数时自动填入输入框", async ({ page }) => {
    await page.goto("/?room=my-test-room");
    await expect(page.locator("#room-input")).toHaveValue("my-test-room");
  });

  test("URL 中携带 version 参数时自动选中版本", async ({ page }) => {
    await page.goto("/?version=23.1.5");
    await expect(page.locator("#version-select")).toHaveValue("23.1.5");
  });
});
