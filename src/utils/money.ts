/**
 * Деньги внутри сервиса — целые копейки. Рубли — только на входе (внешний API) и в ответах.
 */

/** Сумма из внешнего API: число или строка с числом ("250.10"). */
export function parseRub(raw: unknown): number {
  if (typeof raw === "string" && raw.trim() === "") throw new Error("invalid amount: empty string");
  const value = typeof raw === "string" ? Number(raw.trim()) : raw;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`invalid amount: ${JSON.stringify(raw)}`);
  }
  return value;
}

/** Рубли → копейки, с усечением долей копейки без ошибок двоичного умножения. */
export function toKop(rub: number): number {
  if (!Number.isFinite(rub) || rub < 0) throw new Error(`invalid amount: ${rub}`);
  const [coefficient, exponent = "0"] = rub.toString().toLowerCase().split("e");
  const [whole, fraction = ""] = coefficient.split(".");
  const digits = BigInt(whole + fraction);
  const shift = Number(exponent) + 2 - fraction.length;
  const kop = shift >= 0 ? digits * 10n ** BigInt(shift) : digits / 10n ** BigInt(-shift);
  if (kop > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("amount exceeds safe integer range");
  return Number(kop);
}

/** Копейки → рубли для ответа API. */
export function fromKop(kop: number): number {
  return kop / 100;
}
