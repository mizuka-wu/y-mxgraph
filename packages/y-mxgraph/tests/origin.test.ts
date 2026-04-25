import { describe, it, expect } from "vitest";
import { LOCAL_ORIGIN } from "../src/helper/origin";

describe("LOCAL_ORIGIN", () => {
  it("是一个对象", () => {
    expect(typeof LOCAL_ORIGIN).toBe("object");
    expect(LOCAL_ORIGIN).not.toBeNull();
  });

  it("是一个空对象", () => {
    expect(Object.keys(LOCAL_ORIGIN)).toHaveLength(0);
  });

  it("多次导入引用相同（单例）", async () => {
    const { LOCAL_ORIGIN: lo2 } = await import("../src/helper/origin");
    expect(LOCAL_ORIGIN).toBe(lo2);
  });

  it("可用于 Set 比较", () => {
    const origins = new Set<any>([LOCAL_ORIGIN]);
    expect(origins.has(LOCAL_ORIGIN)).toBe(true);
    expect(origins.has({})).toBe(false);
  });
});
