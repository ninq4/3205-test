# orders-aggregator

Сервис забирает заказы интернет-магазина из внешней системы (API поддерживает другая команда),
принимает их обновления через вебхуки и считает статистику по клиентам.

## Стек

Node 20+, TypeScript, Fastify, PostgreSQL (`pg`), Zod, Vitest.

## Запуск

Образ внешнего API лежит рядом с этой папкой — загрузите тот, что под вашу архитектуру (`uname -m`):

```bash
docker load -i ../orders-mock-arm64.tar.gz   # arm64 / aarch64 (Mac на Apple Silicon)
docker load -i ../orders-mock-amd64.tar.gz   # x86_64
```

Полностью в Docker (миграции выполняются при старте приложения):

```bash
cp .env.example .env
docker compose up -d --build  # приложение :3000, PostgreSQL :5432, внешний API :4000
curl -fsS http://localhost:3000/health
```

Для разработки с Node на хосте:

```bash
docker compose up -d postgres orders-api
npm ci
npm run migrate
npm run dev                  # http://localhost:3000
```

Если контейнер `app` уже работает, перед `npm run dev` остановите его: `docker compose stop app`.
`src/config.ts` читает переменные окружения; значения по умолчанию совпадают с `.env.example`.
При изменении адресов для запуска на хосте экспортируйте соответствующие переменные.

Отправка вебхуков из внешней системы (для разработки запускается вручную, сервис должен быть запущен):

```bash
docker compose run --rm orders-api webhooks --target http://host.docker.internal:3000/webhooks/order
```

Тесты (нужен запущенный PostgreSQL):

```bash
npm ci
npm run typecheck
npm test
```

## Структура

```
src/
  app.ts              Fastify-приложение, обработка ошибок
  container.ts        сборка зависимостей
  db.ts               пул соединений, миграции
  clients/            клиент внешнего API (лимиты, ретраи)
  repositories/       доступ к данным
  services/           бизнес-логика
  routes/             HTTP-слой
  utils/              деньги, время
migrations/           SQL-миграции, применяются по порядку
test/                 интеграционные тесты на реальной БД (внешний API — фейк)
```

## Соглашения

- Деньги внутри сервиса — в копейках (integer). Рубли — только на входе из внешнего API и в ответах.
- Время храним в UTC (`TIMESTAMPTZ`).
- Ошибки бизнес-логики — наследники `AppError`, в ответе `{ error: <код>, message }`.

## API сервиса

| Метод | Путь | Описание |
|---|---|---|
| POST | `/sync` | Забрать все заказы из внешнего API. Отвечает статистикой, когда всё забрано |
| POST | `/webhooks/order` | Обновление заказа (тело — `Order` внешнего API). Повтор/устаревшая версия → `200 { result: "stale" }` |
| GET | `/customers/:id/daily-totals?from=YYYY-MM-DD&to=YYYY-MM-DD` | Оплаченные (`paid`) заказы по дням в таймзоне клиента: `[{ date, total, gross, discount, net }]` |
| GET | `/health` | Проверка живости |

## Внешний API (`ORDERS_API_URL`)

- `GET /orders?cursor=<string>&limit=<1..100>` → `{ items: Order[], nextCursor: string | null }`. Лимит 5 rps.
- `GET /customers/:id` → `{ id, timezone }` (IANA, например `Europe/Berlin`).
- Вебхуки: `POST` на наш `/webhooks/order`, тело — `Order`. Повторная доставка возможна.

```ts
type Order = {
  id: string;
  customerId: string;
  amount: number;          // сумма заказа в рублях, до скидки
  discountPercent: number; // скидка, % (0 — без скидки)
  amountPaid: number;      // оплачено, в рублях: amount со скидкой
  status: "pending" | "paid" | "refunded";
  createdAt: string;       // ISO 8601, UTC
  updatedAt: string;       // ISO 8601, UTC
};
```

`gross` и совместимое поле `total` — сумма до скидок. `net` — сумма `amountPaid`,
`discount = gross - net`. Все суммы в ответе — рубли, внутри — целые копейки.
Если `amountPaid` отсутствует (старый формат API), `net = gross`.
Процент не используется для пересчёта фактической оплаты.

## Получение результата задания

На первом запуске рабочая БД должна быть пустой. Команды выполнять последовательно,
дожидаясь завершения sync и отправки вебхуков:

```bash
docker compose up -d --build
curl -fsS -X POST http://localhost:3000/sync
docker compose run --rm orders-api webhooks --target http://host.docker.internal:3000/webhooks/order
curl -fsS 'http://localhost:3000/customers/c_7/daily-totals?from=2026-03-27&to=2026-03-31' > result.json
npm run verify-result
```

`verify-result` независимо пересчитывает сохранённые заказы средствами PostgreSQL
(`AT TIME ZONE`) и сравнивает с `result.json`. Подробности проверки — в `SOLUTION.md`.
