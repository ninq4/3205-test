import type { OrdersRepository } from "../repositories/orders.js";
import { fromKop } from "../utils/money.js";
import { dateInTimezone, datesBetween } from "../utils/time.js";
import type { CustomersService } from "./customers.js";

export interface DailyTotal {
  date: string;
  total: number;
  gross: number;
  discount: number;
  net: number;
}

const DAY = 86_400_000;

export class TotalsService {
  constructor(
    private readonly orders: OrdersRepository,
    private readonly customers: CustomersService,
  ) {}

  /**
   * Сумма оплаченных заказов клиента по дням в его таймзоне, from..to включительно.
   * Дни без оплат — с нулём.
   */
  async daily(customerId: string, from: string, to: string): Promise<DailyTotal[]> {
    const timezone = await this.customers.timezone(customerId);

    // Смещения таймзон в пределах ±14 ч: берём с запасом в сутки с каждой стороны
    const rows = await this.orders.paidCreatedBetween(
      customerId,
      new Date(Date.parse(`${from}T00:00:00Z`) - DAY),
      new Date(Date.parse(`${to}T00:00:00Z`) + 2 * DAY),
    );

    const sums = new Map(datesBetween(from, to).map((d) => [d, { gross: 0, net: 0 }]));
    for (const o of rows) {
      const date = dateInTimezone(o.createdAt, timezone);
      const cur = sums.get(date);
      if (cur) {
        cur.gross += o.amountKop;
        cur.net += o.amountPaidKop ?? o.amountKop;
        if (!Number.isSafeInteger(cur.gross) || !Number.isSafeInteger(cur.net)) {
          throw new Error("daily total exceeds safe integer range");
        }
      }
    }
    return [...sums].map(([date, { gross, net }]) => ({
      date, total: fromKop(gross), gross: fromKop(gross),
      discount: fromKop(gross - net), net: fromKop(net),
    }));
  }
}
