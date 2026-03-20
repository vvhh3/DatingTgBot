# Railway + PostgreSQL

Этот бот можно развернуть на Railway с PostgreSQL вместо локального SQLite-файла.

## Почему так удобнее

- Таблицы можно смотреть прямо в UI Railway.
- Не нужно заходить в контейнер и читать `.db` файл через `railway ssh`.
- Данные не завязаны на файловый volume для SQLite.

## Что должно быть готово заранее

- Проект загружен в GitHub.
- У тебя есть новый актуальный `BOT_TOKEN`.
- В `.env` уже известны `MODERATION_CHAT_ID`, `TARGET_CHAT_ID`, `ADMIN_USER_IDS`.

## Пошаговый деплой в Railway

### 1. Создать проект из GitHub

1. Зайди в Railway.
2. Нажми `New Project`.
3. Нажми `Deploy from GitHub repo`.
4. Выбери свой репозиторий с ботом.

### 2. Добавить PostgreSQL

1. Внутри проекта нажми `New`.
2. Выбери `Database`.
3. Выбери `Add PostgreSQL`.
4. Назови сервис `Postgres`.

Важно: если назовёшь сервис не `Postgres`, то ссылка в переменной `DATABASE_URL` будет другой.

### 3. Открыть переменные бота

1. Открой сервис с ботом.
2. Перейди в `Variables`.
3. Добавь переменные ниже.

## Exact values для Variables

Если сервис базы называется именно `Postgres`, вставляй так:

```env
BOT_TOKEN=твой_новый_токен_бота
DATABASE_URL=${{Postgres.DATABASE_URL}}
DATABASE_SSL=false
MODERATION_CHAT_ID=-1001234567890
TARGET_CHAT_ID=-1009876543210
ADMIN_USER_IDS=111111111,222222222
DISPLAY_TIMEZONE=Europe/Moscow
SUBMISSION_COOLDOWN_SECONDS=15
```

Что означает каждая переменная:

- `BOT_TOKEN` - токен от `@BotFather`
- `DATABASE_URL` - ссылка на Railway Postgres через reference variable
- `DATABASE_SSL` - для внутреннего подключения в Railway ставь `false`
- `MODERATION_CHAT_ID` - ID чата модерации
- `TARGET_CHAT_ID` - ID канала или чата публикации
- `ADMIN_USER_IDS` - Telegram user id админов через запятую
- `DISPLAY_TIMEZONE` - например `Europe/Moscow`
- `SUBMISSION_COOLDOWN_SECONDS` - например `15`

Если хочешь, чтобы модерировать мог любой участник чата модерации, оставь:

```env
ADMIN_USER_IDS=
```

### 4. Проверить build и start

Открой у сервиса бота `Settings` и проверь команды:

- `Build Command`: `npm ci && npm run build`
- `Start Command`: `npm start`

Если Railway сам определил их правильно, можно не менять.

### 5. Запустить деплой

1. Нажми `Deploy` или `Redeploy`.
2. Дождись статуса `Success`.
3. Открой `Logs` и проверь, что бот стартовал без ошибок.

## Как смотреть данные в UI Railway

1. Открой сервис `Postgres`.
2. Перейди в `Data` или `Database View`.
3. Найди таблицу `submissions`.
4. Открой её и смотри строки прямо в интерфейсе.

Пример SQL-запроса:

```sql
SELECT id, status, text, created_at
FROM submissions
ORDER BY created_at DESC
LIMIT 20;
```

Ещё полезные запросы:

```sql
SELECT status, COUNT(*) AS total
FROM submissions
GROUP BY status
ORDER BY status;
```

```sql
SELECT id, username, first_name, status, rejection_reason
FROM submissions
WHERE status = 'rejected'
ORDER BY created_at DESC
LIMIT 20;
```

## Что будет при первом запуске

- Бот сам создаст таблицу `submissions`, если её ещё нет.
- Никакие ручные SQL-миграции для первого деплоя не нужны.

## Если раньше был SQLite

Этот переход не переносит старый `data/submissions.db` автоматически.
Если в SQLite уже есть нужные данные, их надо мигрировать отдельно перед окончательным переходом на PostgreSQL.
