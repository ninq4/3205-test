import { describe, expect, it, vi } from "vitest";
import { apiOrder, dailyTotals, postWebhook, setupTestApp } from "./helpers.js";

const ctx = setupTestApp();

describe("скидки", () => {
  it("суммирует фактические платежи, legacy-заказы и полную скидку в целых копейках", async () => {
    // amountPaid — источник истины, даже если процент даёт другую сумму.
    await postWebhook(ctx.app, apiOrder({ amount: 100, discountPercent: 10, amountPaid: "89.99" }));
    await postWebhook(ctx.app, apiOrder({ amount: "0.29" }));
    await postWebhook(ctx.app, apiOrder({ amount: 1.13, discountPercent: 100, amountPaid: 0 }));
    await postWebhook(ctx.app, apiOrder({ amount: 500, amountPaid: 400, status: "pending" }));
    await postWebhook(ctx.app, apiOrder({ amount: 500, amountPaid: 400, status: "refunded" }));
    const res = await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-11");
    expect(res.json()).toEqual([
      { date: "2026-02-10", total: 101.42, gross: 101.42, discount: 11.14, net: 90.28 },
      { date: "2026-02-11", total: 0, gross: 0, discount: 0, net: 0 },
    ]);
  });

  it("сохраняет скидку из sync и обновляет её вебхуком, игнорируя старые версии", async () => {
    const order = apiOrder({ amount: "2500.00", discountPercent: 10, amountPaid: "2250.00" });
    ctx.api.pages.set(null, { items: [order], nextCursor: null });
    expect((await ctx.app.inject({ method: "POST", url: "/sync" })).json()).toMatchObject({ applied: 1 });
    const newer = { ...order, discountPercent: 16.5, amountPaid: "2087.50", updatedAt: "2026-02-11T12:00:00Z" };
    expect((await postWebhook(ctx.app, newer)).json()).toEqual({ result: "updated" });
    expect((await postWebhook(ctx.app, newer)).json()).toEqual({ result: "stale" });
    expect((await postWebhook(ctx.app, order)).json()).toEqual({ result: "stale" });
    expect((await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10")).json()).toEqual([
      { date: "2026-02-10", total: 2500, gross: 2500, discount: 412.5, net: 2087.5 },
    ]);
  });

  it("позволяет обогатить legacy-версию платежом без смены updatedAt", async () => {
    const legacy = apiOrder();
    await postWebhook(ctx.app, legacy);
    const enriched = { ...legacy, amountPaid: 900, discountPercent: 10 };
    expect((await postWebhook(ctx.app, enriched)).json()).toEqual({ result: "updated" });
    expect((await postWebhook(ctx.app, enriched)).json()).toEqual({ result: "stale" });
    expect((await postWebhook(ctx.app, legacy)).json()).toEqual({ result: "stale" });
    expect((await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10")).json()[0].net).toBe(900);
  });

  it("не обогащает старую версию и не меняет остальные поля версии с тем же временем", async () => {
    const order = apiOrder();
    await postWebhook(ctx.app, order);
    expect((await postWebhook(ctx.app, { ...order, amountPaid: 900, status: "refunded" })).json()).toEqual({ result: "stale" });
    expect((await postWebhook(ctx.app, { ...order, amountPaid: 900, updatedAt: "2026-02-09T00:00:00Z" })).json()).toEqual({ result: "stale" });
  });

  it.each([null, "abc", "", -1, 1001])("не принимает некорректную оплату %j", async (amountPaid) => {
    expect((await postWebhook(ctx.app, apiOrder({ amountPaid }))).statusCode).toBe(400);
  });

  it("sync считает невалидную оплату и продолжает обработку", async () => {
    ctx.api.pages.set(null, { items: [apiOrder({ amountPaid: "oops" }), apiOrder({ amountPaid: 900 })], nextCursor: null });
    expect((await ctx.app.inject({ method: "POST", url: "/sync" })).json()).toMatchObject({ received: 2, applied: 1, invalid: 1 });
  });
});

describe("календарные дни Europe/Berlin", () => {
  it("учитывает весенний DST и не зависит от даты запуска сервиса", async () => {
    ctx.api.customers.set("c_7", "Europe/Berlin");
    const orders = [
      { createdAt: "2026-03-26T23:00:00Z", amount: 10, amountPaid: 9 }, // 27 марта 00:00 CET
      { createdAt: "2026-03-28T22:30:00Z", amount: 20, amountPaid: 18 }, // 28 марта 23:30 CET
      { createdAt: "2026-03-28T23:00:00Z", amount: 30, amountPaid: 27 }, // 29 марта 00:00 CET
      { createdAt: "2026-03-29T21:59:59Z", amount: 40, amountPaid: 36 }, // 29 марта 23:59 CEST
      { createdAt: "2026-03-29T22:00:00Z", amount: 50, amountPaid: 45 }, // 30 марта 00:00 CEST
      { createdAt: "2026-03-31T22:00:00Z", amount: 100, amountPaid: 90 }, // уже 1 апреля
    ];
    for (const order of orders) await postWebhook(ctx.app, apiOrder({ ...order, customerId: "c_7" }));
    const expected = [
      { date: "2026-03-27", total: 10, gross: 10, discount: 1, net: 9 },
      { date: "2026-03-28", total: 20, gross: 20, discount: 2, net: 18 },
      { date: "2026-03-29", total: 70, gross: 70, discount: 7, net: 63 },
      { date: "2026-03-30", total: 50, gross: 50, discount: 5, net: 45 },
      { date: "2026-03-31", total: 0, gross: 0, discount: 0, net: 0 },
    ];
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      for (const now of ["2026-01-15T12:00:00Z", "2026-07-15T12:00:00Z"]) {
        vi.setSystemTime(new Date(now));
        const res = await dailyTotals(ctx.app, "c_7", "2026-03-27", "2026-03-31");
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual(expected);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("учитывает оба повторяющихся часа при осеннем переводе часов", async () => {
    ctx.api.customers.set("c_7", "Europe/Berlin");
    for (const createdAt of ["2026-10-25T00:30:00Z", "2026-10-25T01:30:00Z", "2026-10-25T22:30:00Z"]) {
      await postWebhook(ctx.app, apiOrder({ customerId: "c_7", createdAt, amount: 1.13, amountPaid: 1.01 }));
    }
    expect((await dailyTotals(ctx.app, "c_7", "2026-10-25", "2026-10-25")).json()).toEqual([
      { date: "2026-10-25", total: 3.39, gross: 3.39, discount: 0.36, net: 3.03 },
    ]);
  });

  it.each([
    ["Pacific/Kiritimati", "2026-02-09T10:00:00Z"],
    ["Etc/GMT+12", "2026-02-11T11:59:59Z"],
  ])("включает границы диапазона в %s", async (timezone, createdAt) => {
    ctx.api.customers.set("c_1", timezone);
    await postWebhook(ctx.app, apiOrder({ createdAt, amount: 1, amountPaid: 0.29 }));
    expect((await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10")).json()).toEqual([
      { date: "2026-02-10", total: 1, gross: 1, discount: 0.71, net: 0.29 },
    ]);
  });
});
