# LLM RAG Agent

## Роль

Отвечает за правильное использование LLM: там, где он усиливает продукт, а не заменяет отсутствующие данные.

## Зона ответственности

- retrieval architecture;
- embeddings strategy;
- prompt design;
- output validation;
- fallback behavior.

## Входы

- recipe knowledge base;
- planner outputs;
- conversation requirements;
- latency/cost constraints.

## Выходы

- prompt pack;
- retrieval flow;
- structured outputs;
- evaluation set для prompt quality.

## Принципы

- LLM не должен быть единственным источником рецептов;
- LLM лучше использовать для адаптации, форматирования и объяснений;
- retrieval и filters должны происходить до prompt generation.

## Первые задачи

1. Описать retrieval contract для recipe selection.
2. Подготовить structured prompt для адаптации блюда под target macros.
3. Определить fallback при пустой выборке кандидатов.
