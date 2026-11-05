---
lang: uk
---
# Паспорт проєкту

## 1. Транспорт і сервер
Vite dev на :5173, API на :8080 (`docker compose up api`). Докладно — `docs/dev.md`.

## 2. Інструменти проєкту
Стек: vite, typescript, vitest, playwright
npm, TypeScript 5, vitest, playwright для e2e, eslint — `package.json`.

## 3. Команда перевірки й очікуваний підсумок
`npm test && npm run typecheck` → очікувано: 0 failed, 0 помилок типів.

## 4. Кеш після правки
Після правки `src/cart/*` перезапустити API: `docker compose restart api`.

## 5. Обрив з'єднання

## 6. Де зразки й канон
Зразки компонентів — `src/ui/examples/`, зразок тесту — `src/cart/__tests__/city.test.ts`.

## 7. Що не чіпати

## 8. Що ще має бути, крім зеленої перевірки
Міграція БД з відкатом; знімок екрана в PR, якщо змінювався вигляд.

## 9. Журнал
`CHANGELOG.md`
