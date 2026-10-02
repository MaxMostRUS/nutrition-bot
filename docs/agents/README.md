# Development Agents

Эта папка описывает рабочую структуру агентной команды для развития `nutrition-bot`.

Цель:
- разделить продуктовую, дата-, LLM- и backend-ответственность;
- сократить хаос при параллельной разработке;
- сделать переход от "бот на промптах" к "бот с knowledge base и planner".

## Состав агентов

1. `product-research-agent.md`
2. `recipe-kb-agent.md`
3. `nutrition-planner-agent.md`
4. `llm-rag-agent.md`
5. `backend-agent.md`
6. `ux-conversation-agent.md`
7. `qa-evaluation-agent.md`

## Общий workflow

1. Product/Research Agent формирует требования и KPI.
2. Recipe KB Agent готовит схему и наполнение рецептурной базы.
3. Nutrition Planner Agent проектирует логику подбора меню.
4. LLM/RAG Agent определяет, где нужен retrieval и где нужен LLM.
5. Backend Agent интегрирует это в код и БД.
6. UX/Conversation Agent встраивает логику в Telegram flow.
7. QA/Evaluation Agent проверяет качество меню и регрессии.

## Первый рабочий цикл

1. Утвердить новый data model для рецептов.
2. Ввести миграции и стартовую recipe knowledge base schema.
3. Описать MVP planner, который выбирает блюда из базы, а не придумывает их с нуля.
4. Расширить профиль пользователя.
5. Подготовить evaluation criteria для разнообразия меню.
