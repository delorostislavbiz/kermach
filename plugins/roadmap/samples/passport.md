# Паспорт проекта

## 1. Транспорт и сервер
Vite dev на :5173, API на :8080 (`docker compose up api`). Подробно — `docs/dev.md`.

## 2. Инструменты проекта
Стек: vite, typescript, vitest, playwright
npm, TypeScript 5, vitest, playwright для e2e, eslint — `package.json`.

## 3. Команда проверки и ожидаемый итог
`npm test && npm run typecheck` → ожидаемо: 0 failed, 0 ошибок типов.

## 4. Кэш после правки
После правки `src/cart/*` перезапустить API: `docker compose restart api`.

## 5. Обрыв соединения

## 6. Где образцы и канон
Образцы компонентов — `src/ui/examples/`, образец теста — `src/cart/__tests__/city.test.ts`.

## 7. Что не трогать

## 8. Что ещё обязано быть, кроме зелёной проверки
Миграция БД с откатом; снимок экрана в PR, если менялся вид.

## 9. Журнал
`CHANGELOG.md`
