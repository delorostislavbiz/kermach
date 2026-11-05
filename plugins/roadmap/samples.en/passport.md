---
lang: en
---
# Project passport

## 1. Transport and server
Vite dev on :5173, API on :8080 (`docker compose up api`). Details — `docs/dev.md`.

## 2. Project tools
Стек: vite, typescript, vitest, playwright
npm, TypeScript 5, vitest, playwright for e2e, eslint — `package.json`.

## 3. Check command and expected result
`npm test && npm run typecheck` → expected: 0 failed, 0 type errors.

## 4. Cache after an edit
After an edit of `src/cart/*` restart the API: `docker compose restart api`.

## 5. Connection loss

## 6. Samples and canon
Component samples — `src/ui/examples/`, a sample test — `src/cart/__tests__/city.test.ts`.

## 7. Do not touch

## 8. Required besides a green check
A DB migration with a rollback; a screenshot in the PR if the look changed.

## 9. Log
`CHANGELOG.md`
