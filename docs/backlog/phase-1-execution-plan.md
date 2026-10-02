# Phase 1 Execution Plan

Фокус первого этапа:
- перестать зависеть только от prompt-only генерации;
- заложить foundation для recipe knowledge base;
- начать переход на deterministic menu planning.

## Track A. Platform Foundation

1. Ввести миграции БД.
2. Создать recipe knowledge base schema.
3. Добавить script для запуска миграций.

## Track B. Data Model

1. Добавить таблицы рецептов и ингредиентов.
2. Добавить таблицы тегов и nutrition metadata.
3. Добавить таблицы пользовательских предпочтений и feedback.

## Track C. Planner Architecture

1. Выделить `recipeCatalogService`.
2. Выделить `menuPlannerService`.
3. Добавить candidate filtering.
4. Добавить weekly diversity scoring.

## Track D. UX

1. Расширить onboarding profile.
2. Добавить режимы меню.
3. Добавить feedback после просмотра блюда.
4. Добавить сценарий замены блюда.

## Track E. Evaluation

1. Определить metrics dashboard.
2. Подготовить golden test profiles.
3. Добавить smoke checks на menu generation и shopping list.

## First Build Order

1. Migration runner.
2. Recipe KB schema migration.
3. README update для локального запуска миграций.
4. Затем сервисы `recipeCatalogService` и `userPreferenceService`.
