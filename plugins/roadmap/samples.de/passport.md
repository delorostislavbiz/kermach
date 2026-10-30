---
lang: de
---
# Projektsteckbrief

## 1. Transport und Server
Vite dev auf :5173, API auf :8080 (`docker compose up api`). Ausführlich — `docs/dev.md`.

## 2. Projektwerkzeuge
Стек: vite, typescript, vitest, playwright
npm, TypeScript 5, vitest, playwright für e2e, eslint — `package.json`.

## 3. Prüfbefehl und erwartetes Ergebnis
`npm test && npm run typecheck` → erwartet: 0 failed, 0 Typfehler.

## 4. Cache nach einer Änderung
Nach einer Änderung an `src/cart/*` die API neu starten: `docker compose restart api`.

## 5. Verbindungsabbruch

## 6. Muster und Kanon
Muster der Komponenten — `src/ui/examples/`, Muster eines Tests — `src/cart/__tests__/city.test.ts`.

## 7. Nicht anfassen

## 8. Pflicht außer grüner Prüfung
DB-Migration mit Rücknahme; Screenshot im PR, wenn sich das Aussehen geändert hat.

## 9. Protokoll
`CHANGELOG.md`
