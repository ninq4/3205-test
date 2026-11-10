import { describe, expect, it } from "vitest";
import { apiOrder, postWebhook, setupTestApp } from "./helpers.js";

const ctx = setupTestApp();

describe("POST /webhooks/order", () => {
  it("создаёт заказ", async () => {
    const res = await postWebhook(ctx.app, apiOrder());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ result: "created" });
  });

  it("повтор того же события ничего не меняет", async () => {
    const o = apiOrder();
    await postWebhook(ctx.app, o);
    expect((await postWebhook(ctx.app, o)).json()).toEqual({ result: "stale" });
  });

  it("устаревшее событие после нового игнорируется", async () => {
    const o = apiOrder({ status: "paid", updatedAt: "2026-02-10T12:00:00Z" });
    await postWebhook(ctx.app, { ...o, status: "refunded", updatedAt: "2026-02-11T12:00:00Z" });
    expect((await postWebhook(ctx.app, o)).json()).toEqual({ result: "stale" });
    const { rows } = await ctx.db.query(`SELECT status FROM orders WHERE id = $1`, [o.id]);
    expect(rows[0].status).toBe("refunded");
  });

  it("новое событие обновляет заказ", async () => {
    const o = apiOrder({ status: "pending" });
    await postWebhook(ctx.app, o);
    const res = await postWebhook(ctx.app, { ...o, status: "paid", updatedAt: "2026-02-11T00:00:00Z" });
    expect(res.json()).toEqual({ result: "updated" });
  });

  it("невалидное тело — 400", async () => {
    const res = await postWebhook(ctx.app, { id: "x" });
    expect(res.statusCode).toBe(400);
  });

  it("при конкурентных обновлениях сохраняет самую свежую версию", async () => {
    const order = apiOrder({ amountPaid: 900 });
    await postWebhook(ctx.app, order);
    const responses = await Promise.all(Array.from({ length: 20 }, (_, i) => postWebhook(ctx.app, {
      ...order,
      amountPaid: 800 - i,
      updatedAt: new Date(Date.parse(order.updatedAt) + (20 - i) * 1000).toISOString(),
    })));
    expect(responses.every((r) => r.statusCode === 200)).toBe(true);
    const { rows } = await ctx.db.query("SELECT amount_paid_kop, updated_at FROM orders WHERE id = $1", [order.id]);
    expect(Number(rows[0].amount_paid_kop)).toBe(80000);
    expect(rows[0].updated_at.toISOString()).toBe("2026-02-10T12:00:20.000Z");
  });
});
