SELECT count(*) AS orders, count(amount_paid_kop) AS with_payment,
       count(*) FILTER (WHERE customer_id = 'c_7') AS c7_orders
FROM orders;

WITH paid AS (
  SELECT amount_kop,
         (created_at AT TIME ZONE 'Europe/Berlin')::date AS local_day,
         ((created_at AT TIME ZONE 'UTC') + interval '1 hour')::date AS fixed_winter_day,
         ((created_at AT TIME ZONE 'UTC') + interval '2 hours')::date AS fixed_summer_day
  FROM orders WHERE customer_id = 'c_7' AND status = 'paid'
), days AS (
  SELECT generate_series('2026-03-27'::date, '2026-03-31'::date, '1 day')::date AS day
)
SELECT day,
  (SELECT coalesce(sum(amount_kop), 0)/100 FROM paid WHERE local_day = day) AS correct_gross,
  (SELECT coalesce(sum(amount_kop), 0)/100 FROM paid WHERE fixed_winter_day = day) AS fixed_utc_plus_1,
  (SELECT coalesce(sum(amount_kop), 0)/100 FROM paid WHERE fixed_summer_day = day) AS fixed_utc_plus_2
FROM days ORDER BY day;

SELECT id, created_at,
       created_at AT TIME ZONE 'Europe/Berlin' AS berlin,
       ((created_at AT TIME ZONE 'UTC') + interval '1 hour') AS incorrect_fixed_winter
FROM orders WHERE customer_id = 'c_7' AND status = 'paid'
  AND (created_at AT TIME ZONE 'Europe/Berlin')::date BETWEEN '2026-03-27' AND '2026-03-31'
  AND (created_at AT TIME ZONE 'Europe/Berlin')::date != ((created_at AT TIME ZONE 'UTC') + interval '1 hour')::date
ORDER BY created_at LIMIT 5;
