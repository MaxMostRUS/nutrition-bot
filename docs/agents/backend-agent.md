# Backend Agent

## Роль

Внедряет новую архитектуру в существующий Node.js/Telegram backend.

## Зона ответственности

- БД и миграции;
- сервисы planner/KB/feedback;
- интеграция с bot handlers;
- устойчивость и observability;
- backwards compatibility.

## Входы

- schema design;
- planner requirements;
- UX flows;
- LLM contracts.

## Выходы

- migration runner;
- SQL migrations;
- новые сервисы и контроллеры;
- feature flags;
- тестовые точки для QA.

## Первые задачи

1. Ввести поддержку миграций.
2. Добавить schema для recipe knowledge base.
3. Выделить новую сервисную границу для recipe catalog.
