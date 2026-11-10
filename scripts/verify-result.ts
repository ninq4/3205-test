import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { config } from "../src/config.js";
import { createDb } from "../src/db.js";

// Независимый расчёт: календарные дни определяет PostgreSQL, а не JS-код сервиса.
const db = createDb(config.databaseUrl);
try {
  const { rows } = await db.query(`
    WITH days AS (
      SELECT generate_series('2026-03-27'::date, '2026-03-31'::date, '1 day')::date AS day
    ), sums AS (
      SELECT (o.created_at AT TIME ZONE c.timezone)::date AS day,
             sum(o.amount_kop)::bigint AS gross,
             sum(coalesce(o.amount_paid_kop, o.amount_kop))::bigint AS net
      FROM orders o JOIN customers c ON c.id = o.customer_id
      WHERE o.customer_id = 'c_7' AND o.status = 'paid'
      GROUP BY 1
    )
    SELECT to_char(d.day, 'YYYY-MM-DD') AS date,
           coalesce(s.gross, 0)::text AS gross, coalesce(s.net, 0)::text AS net
    FROM days d LEFT JOIN sums s USING (day) ORDER BY d.day
  `);
  assert.equal((await db.query("SELECT timezone FROM customers WHERE id = 'c_7'")).rows[0]?.timezone, "Europe/Berlin");
  const expected = rows.map((r) => {
    const gross = BigInt(r.gross);
    const net = BigInt(r.net);
    assert(gross <= BigInt(Number.MAX_SAFE_INTEGER));
    assert(net <= BigInt(Number.MAX_SAFE_INTEGER));
    return { date: r.date, total: Number(gross) / 100, gross: Number(gross) / 100,
      discount: Number(gross - net) / 100, net: Number(net) / 100 };
  });
  const actual = JSON.parse(await readFile(new URL("../result.json", import.meta.url), "utf8"));
  assert.deepEqual(actual, expected);
  console.log("result.json совпадает с независимой агрегацией PostgreSQL для Europe/Berlin (5 дней).");
  const { rows: runs } = await db.query("SELECT pages, received, finished_at, error FROM sync_runs ORDER BY id DESC LIMIT 1");
  assert.equal(runs.length, 1, "не найден завершённый sync");
  assert.equal(runs[0].error, null);
  assert(runs[0].finished_at, "sync ещё не завершён");
  console.log("Последний sync:", runs[0]);
} finally {
  await db.end();
}
