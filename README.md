## Запуск локально

## План развития

Единый актуальный roadmap, архитектура базы знаний, агентная структура, этапы production и критерии качества находятся в [docs/PROJECT_ROADMAP.md](docs/PROJECT_ROADMAP.md). Этот документ обновляется после значимых изменений проекта.

### Вариант A: webhook через ngrok (рекомендуется для локальной отладки)

1) Запустите ngrok:
```bash
ngrok http 3000
```

2) Создайте файл `.env` на основе `.env.example` и заполните переменные окружения:
- `BOT_TOKEN`
- `OPENAI_API_KEY`
- `DATABASE_URL`
- `WEBHOOK_URL` = ваш HTTPS URL из ngrok (например `https://xxxx.ngrok-free.app`)
- (опционально) `TELEGRAM_WEBHOOK_SECRET` для защиты вебхука

3) Установите зависимости и запустите:
```bash
npm install
npm run migrate
npm run dev
```

Приложение само установит webhook при старте, если задан `WEBHOOK_URL`.

### Вариант B: long polling (без webhook)

Просто не задавайте `WEBHOOK_URL` и запустите:
```bash
npm install
npm run migrate
npm run dev
```

### Миграции

В проекте появился отдельный шаг миграций:

```bash
npm run migrate
```

Сейчас он:
- применяет базовую схему из `sql/init.sql`;
- затем применяет SQL-файлы из `sql/migrations/` по порядку;
- хранит примененные миграции в `schema_migrations`.

### Seed рецептов

Чтобы наполнить стартовый каталог рецептов для planner:

```bash
npm run seed:recipes
```

Скрипт:
- создает стартовый набор рецептов для `breakfast`, `lunch`, `dinner`;
- помечает их как `active`;
- пропускает рецепты, которые уже есть по названию.

### PDF-книги как knowledge base

Чтобы загрузить кулинарные книги в searchable knowledge base:

```bash
npm run ingest:books
```

Скрипт:
- берет PDF-книги из `src/data/pdfBookSources.js`;
- извлекает текст постранично;
- режет его на searchable chunks;
- сохраняет их в таблицы `knowledge_documents` и `knowledge_chunks`.

После этого bot fallback для генерации рецептов сможет использовать фрагменты из книг как grounding.

### Локальная Postgres-база через Docker

Если у вас нет локального Postgres, можно использовать helper script:

```bash
chmod +x ./start_postgres.sh
./start_postgres.sh
```

Скрипт:
- поднимает контейнер `nutrition-bot-postgres`;
- использует порт `54329`;
- печатает готовый `DATABASE_URL`.

В репозитории уже подготовлен локальный `.env` для этого dev-сценария:

```env
DATABASE_URL=postgres://nutrition:nutrition@localhost:54329/nutrition_bot
```

После запуска Docker-постаgres можно выполнить:

```bash
npm run migrate
npm run seed:recipes
```

### Установка вебхука вручную (опционально)

Если нужно установить webhook вручную:
```bash
curl -X POST "https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook?url=YOUR_HTTPS_URL"
```

### Premium и Telegram Stars

Внутри Telegram цифровой доступ продается через Telegram Stars:

```text
/trial    бесплатная тестовая неделя
/premium  счет на 30 дней Premium
```

Текущая цена по умолчанию: `199 XTR` за 30 дней. Ее можно изменить через `PREMIUM_PLAN_STARS`. Обработчики сохраняют Telegram charge id и не активируют один платеж повторно.

Для оплаты банковской картой можно подключить Tribute. После создания цифрового товара укажите его ссылку и API-ключ:

```env
TRIBUTE_API_KEY=...
TRIBUTE_PRODUCT_URL=https://web.tribute.tg/p/...
TRIBUTE_PRODUCT_ID=...
TRIBUTE_WEBHOOK_PATH=/webhook/tribute
```

В кабинете Tribute укажите публичный HTTPS URL вида `https://your-domain.example/webhook/tribute`. Бот проверяет `trbt-signature`, обрабатывает повторные webhook-события по `purchase_id` и активирует Premium на 30 дней.

### Удаленный запуск через Docker Compose

На VPS с Docker установите секреты в `.env.production` и запустите:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build
```

В production `DATABASE_URL` внутри контейнера собирается автоматически и не должен указывать на `localhost`.

#### Render Blueprint

Файл `render.yaml` готов для запуска через Render Blueprint. После создания сервиса в панели Render добавьте `BOT_TOKEN`, `OPENAI_API_KEY` и Tribute credentials. После первого деплоя публичный URL сервиса используется как `https://<service-name>.onrender.com/webhook/tribute` в кабинете Tribute.
