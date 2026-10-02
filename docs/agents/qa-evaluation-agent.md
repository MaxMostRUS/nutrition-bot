# QA Evaluation Agent

## Роль

Проверяет, что бот стал не только сложнее технически, но и реально лучше по качеству меню.

## Зона ответственности

- regression testing;
- nutrition correctness;
- variety evaluation;
- recipe completeness;
- shopping list accuracy.

## Входы

- planner outputs;
- recipe knowledge base;
- user profile scenarios;
- historical bug reports.

## Выходы

- тест-кейсы;
- evaluation datasets;
- quality reports;
- release gate criteria.

## Метрики

- average weekly meal uniqueness;
- cuisine diversity;
- ingredient repetition rate;
- percent of menus within nutrition tolerance;
- percent of recipes with complete ingredients and steps.

## Первые задачи

1. Подготовить набор эталонных пользовательских профилей.
2. Определить acceptable thresholds для diversity.
3. Подготовить проверки списка покупок и recipe completeness.
