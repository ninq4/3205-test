import { z } from "zod";
import { ValidationError } from "../errors.js";
import type { Order, OrdersRepository } from "../repositories/orders.js";
import { parseRub, toKop } from "../utils/money.js";
import { parseUtc } from "../utils/time.js";

/** Заказ в формате внешнего API (поля, которые нам нужны; остальные игнорируем). */
const ExternalOrder = z.object({
  id: z.string().min(1),
  customerId: z.string().min(1),
  amount: z.union([z.number(), z.string()]),
  // Фактическая оплата важнее расчёта по discountPercent (округление — на стороне API).
  amountPaid: z.union([z.number(), z.string()]).optional(),
  status: z.enum(["pending", "paid", "refunded"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ApplyResult = "created" | "updated" | "stale";

export class OrdersService {
  constructor(private readonly orders: OrdersRepository) {}

  normalize(raw: unknown): Order {
    const parsed = ExternalOrder.safeParse(raw);
    if (!parsed.success) throw new ValidationError(`invalid order: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
    const o = parsed.data;
    try {
      const amountKop = toKop(parseRub(o.amount));
      const amountPaidKop = o.amountPaid === undefined ? null : toKop(parseRub(o.amountPaid));
      if (amountPaidKop !== null && amountPaidKop > amountKop) {
        throw new Error("amountPaid must not exceed amount");
      }
      return {
        id: o.id,
        customerId: o.customerId,
        amountKop,
        amountPaidKop,
        status: o.status,
        createdAt: parseUtc(o.createdAt),
        updatedAt: parseUtc(o.updatedAt),
      };
    } catch (e) {
      throw new ValidationError((e as Error).message);
    }
  }

  /**
   * Применяет версию заказа (из синка или вебхука).
   * Вебхуки приходят с повторами и не по порядку, поэтому версию сохраняем,
   * только если она новее уже сохранённой (по updatedAt). Исключение: legacy-версию
   * с тем же временем и прежними полями можно обогатить отсутствовавшей оплатой.
   */
  async apply(raw: unknown): Promise<ApplyResult> {
    const incoming = this.normalize(raw);
    return this.orders.save(incoming);
  }
}
