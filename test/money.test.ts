import { describe, expect, it } from "vitest";
import { fromKop, parseRub, toKop } from "../src/utils/money.js";

describe("parseRub", () => {
  it("принимает число и строку с числом", () => {
    expect(parseRub(2500)).toBe(2500);
    expect(parseRub("2500.00")).toBe(2500);
    expect(parseRub(" 99 ")).toBe(99);
  });

  it("отклоняет мусор и отрицательные суммы", () => {
    expect(() => parseRub("abc")).toThrow();
    expect(() => parseRub(null)).toThrow();
    expect(() => parseRub(-1)).toThrow();
    expect(() => parseRub("  ")).toThrow();
  });
});

describe("toKop / fromKop", () => {
  it("рубли в копейки", () => {
    expect(toKop(2500)).toBe(250000);
    expect(toKop(99)).toBe(9900);
  });

  it("отбрасывает доли копейки", () => {
    expect(toKop(10.999)).toBe(1099);
  });

  it("копейки в рубли", () => {
    expect(fromKop(250000)).toBe(2500);
    expect(fromKop(1099)).toBe(10.99);
  });

  it("не теряет копейку при двоичном представлении десятичных сумм", () => {
    expect(toKop(0.29)).toBe(29);
    expect(toKop(1.13)).toBe(113);
    expect(toKop(19.99)).toBe(1999);
    expect(toKop(0.1 + 0.2)).toBe(30);
  });

  it("поддерживает экспоненциальную запись и отбрасывает настоящие доли копейки", () => {
    expect(toKop(1e-7)).toBe(0);
    expect(toKop(1e6)).toBe(100000000);
    expect(toKop(1.009)).toBe(100);
    expect(toKop(0.009999999999)).toBe(0);
  });

  it("отклоняет нечисловые и небезопасные суммы", () => {
    for (const amount of [NaN, Infinity, -1, 1e20]) expect(() => toKop(amount)).toThrow();
  });
});
