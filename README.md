# PostMint AI

Платный AI-генератор продающих Telegram-постов с оплатой в TON.

## Что умеет

- 1 бесплатная генерация для нового пользователя.
- Пакет платных генераций через TON.
- Уникальный комментарий к каждому платежу.
- Проверка оплаты по транзакциям на TON-адрес продавца.
- Генерация через OpenRouter, OpenAI, Groq, Gemini или локальный Ollama.
- Сохранение сессий и заказов в `data/store.json`.

## Локальный запуск

```powershell
cd "D:\проекты 2\ton-ai-post-generator"
node server.js
```

Открыть:

```text
http://localhost:4173
```

## Настройки продаж

В `.env` должны быть:

```text
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-v1...
OPENROUTER_MODEL=openrouter/free

MERCHANT_TON_ADDRESS=твой_TON_адрес
PRICE_TON=0.1
GENERATIONS_PER_PAYMENT=10
FREE_GENERATIONS=1
PUBLIC_BASE_URL=https://твой-домен
PORT=4173
```

Без `MERCHANT_TON_ADDRESS` покупка будет заблокирована, чтобы случайно не принимать оплату на неверный адрес.

## Как работает оплата

1. Пользователь нажимает `Купить через TON`.
2. Сервер создает заказ и комментарий вида `AIPOST-AB12CD34`.
3. Пользователь открывает кошелек по `ton://transfer`.
4. После оплаты нажимает `Я оплатил, проверить`.
5. Сервер ищет транзакцию с нужным комментарием и суммой.
6. Если оплата найдена, добавляет генерации к сессии.

Для надежной проверки на проде лучше добавить `TONAPI_KEY`, но MVP умеет пробовать публичные TON API без ключа.

## Деплой на Render

В проект добавлен `render.yaml`.

Нужен GitHub/GitLab/Bitbucket репозиторий:

```powershell
git init
git add .
git commit -m "Launch PostMint AI"
git branch -M main
git remote add origin <URL_ТВОЕГО_РЕПОЗИТОРИЯ>
git push -u origin main
```

Потом открыть Render Blueprint:

```text
https://dashboard.render.com/blueprint/new
```

В Render нужно заполнить секреты:

```text
OPENROUTER_API_KEY
MERCHANT_TON_ADDRESS
PUBLIC_BASE_URL
TONAPI_KEY
```

После первого деплоя вставь публичный URL Render в `PUBLIC_BASE_URL`.
