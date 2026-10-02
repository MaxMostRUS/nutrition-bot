const JSON5 = require('json5');
const { askChatGPT } = require('./openaiService');
const { getRecipeById } = require('./recipeCatalogService');
const { searchKnowledge, formatKnowledgeSnippets } = require('./knowledgeBaseService');

function parseJson(raw) {
  const cleaned = String(raw || '').replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {}
  return JSON5.parse(cleaned);
}

function formatIngredients(ingredients = []) {
  return ingredients.map((item) => {
    const amount = item.amount === null || item.amount === undefined ? '' : `${item.amount}`;
    const unit = item.unit ? ` ${item.unit}` : '';
    const note = item.note ? ` (${item.note})` : '';
    return `${amount}${unit} ${item.name}`.trim() + note;
  });
}

async function adaptRecipe({ recipeId, target, goal, userPreferences = {}, request = '' }) {
  const sourceRecipe = await getRecipeById(recipeId);
  if (!sourceRecipe) throw new Error(`Recipe not found: ${recipeId}`);

  const knowledge = await searchKnowledge(
    `${sourceRecipe.title} ${sourceRecipe.sourceTitle || ''} ${request}`,
    { sourceType: 'pdf_recipe_book', limit: 3 }
  );
  const knowledgeContext = knowledge.length
    ? `Additional cookbook context. Use it for culinary logic, but do not copy text verbatim:\n${formatKnowledgeSnippets(knowledge)}\n\n`
    : '';

  const prompt = `${knowledgeContext}You are adapting and localizing a trusted catalog recipe for a Russian-speaking user.
Keep the dish recognizable and preserve its core cooking idea. Do not invent an unrelated dish.
Adapt it to the target macros, dietary restrictions, disliked ingredients, equipment and time.
Use practical substitutions and mark nutrition as estimated when needed.
Write the user-facing recipe entirely in natural Russian, not as a literal word-for-word translation.
Use established Russian culinary terms: "обжарить до золотистой корочки", "тушить", "запекать", "пучок", "щепотка", "столовая ложка", "чайная ложка".
Convert cups, ounces and Fahrenheit into grams/ml and Celsius when the conversion is unambiguous.
Translate ingredient names by their culinary meaning; preserve important original product names in parentheses only when a substitution could be ambiguous.
The source title and source metadata are for provenance only and must not be copied into the user-facing title.

Source recipe:
${JSON.stringify({
    title: sourceRecipe.title,
    sourceTitle: sourceRecipe.sourceTitle,
    mealType: sourceRecipe.mealType,
    cuisine: sourceRecipe.cuisine,
    ingredients: formatIngredients(sourceRecipe.ingredients),
    instructions: sourceRecipe.instructions,
    cookingTimeMinutes: sourceRecipe.cookingTimeMinutes,
    servings: sourceRecipe.servings,
    nutrition: sourceRecipe.nutrition,
    tags: sourceRecipe.tags
  }, null, 2)}

Target:
${JSON.stringify({
    calories: target?.calories,
    protein: target?.protein,
    fat: target?.fat,
    carbs: target?.carbs,
    portionWeight: target?.portionWeight,
    goal,
    request,
    userPreferences
  }, null, 2)}

Return only valid JSON:
{
  "title": "естественное русское название блюда",
  "adaptationNotes": ["короткие заметки об изменениях на русском"],
  "ingredients": ["количество единица продукт на русском"],
  "steps": ["шаг приготовления на русском"],
  "cookingTimeMinutes": 0,
  "nutrition": {"calories": 0, "protein": 0, "fat": 0, "carbs": 0, "fiber": 0, "portionWeight": 0},
  "estimatedNutrition": true
}`;

  const raw = await askChatGPT([
    { role: 'system', content: 'You are a careful recipe adaptation assistant. Return JSON only.' },
    { role: 'user', content: prompt }
  ], { temperature: 0.25, json: true, max_tokens: 900, retries: 3 });

  const adapted = parseJson(raw);
  return {
    ...adapted,
    originalTitle: sourceRecipe.title,
    baseRecipeId: recipeId,
    baseRecipeTitle: sourceRecipe.title,
    sourceTitle: sourceRecipe.sourceTitle,
    sourceType: sourceRecipe.sourceType,
    sourceUrl: sourceRecipe.sourceUrl,
    estimatedNutrition: adapted.estimatedNutrition !== false
  };
}

module.exports = { adaptRecipe, formatIngredients };
