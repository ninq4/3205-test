-- NULL distinguishes legacy orders from versions with an explicit payment.
-- Until enriched by sync, legacy orders are counted without a discount.
ALTER TABLE orders ADD COLUMN amount_paid_kop BIGINT;
ALTER TABLE orders ADD CONSTRAINT orders_payment_range
  CHECK (amount_paid_kop IS NULL OR (amount_paid_kop >= 0 AND amount_paid_kop <= amount_kop));
