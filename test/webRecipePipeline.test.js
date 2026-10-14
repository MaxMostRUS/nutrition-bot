const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assessRecipeQuality,
  extractMicrodataRecipe,
  extractRecipeJsonLd,
  mapJsonLdToRecipe,
  mapWikibooksRecipe,
  parseDurationText,
  repairNutritionGovRecipe,
  resolveRecipeRights
} = require('../src/services/webRecipePipeline');
const {
  estimateRecipeNutrition,
  parseIngredientMeasurement
} = require('../src/services/recipeNutritionEstimator');

const reusableSource = {
  id: 'test-source',
  sourceType: 'web_test',
  sourceTitle: 'Test Recipes',
  collectionUrl: 'https://example.test/recipes',
  language: 'en',
  mealType: 'lunch',
  tags: ['test'],
  license: 'CC-BY-SA-4.0',
  licenseUrl: 'https://example.test/license',
  licensePolicy: 'attribution-sharealike',
  allowsAutomaticActivation: true
};

test('parses textual durations in all supported languages', () => {
  assert.equal(parseDurationText('1 hour 20 minutes'), 80);
  assert.equal(parseDurationText('45 minutos'), 45);
  assert.equal(parseDurationText('2 часа'), 120);
});

test('extracts and maps schema.org Recipe without generating fields', () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    '@type': 'Recipe',
    name: 'Bean bowl',
    recipeIngredient: ['1 cup beans', '1 tomato'],
    recipeInstructions: [{ '@type': 'HowToStep', text: 'Combine and heat.' }],
    totalTime: 'PT25M',
    recipeYield: '2 servings',
    recipeCuisine: 'Mexican',
    nutrition: {
      calories: '350 kcal', proteinContent: '18 g', fatContent: '8 g', carbohydrateContent: '50 g'
    }
  })}</script>`;
  const jsonLd = extractRecipeJsonLd(html);
  const recipe = mapJsonLdToRecipe(jsonLd, reusableSource, {
    url: 'https://example.test/bean-bowl',
    discoveredAt: '2026-01-01T00:00:00.000Z'
  });

  assert.equal(recipe.title, 'Bean bowl');
  assert.equal(recipe.ingredients.length, 2);
  assert.equal(recipe.nutrition.protein, 18);
  assert.equal(recipe.language, 'en');
  assert.equal(recipe.provenance.parser, 'schema.org/Recipe');
});

test('maps Russian Wikibooks revision and keeps attribution provenance', () => {
  const source = { ...reusableSource, language: 'ru', mealType: 'dinner', sourceTitle: 'Викиучебник' };
  const payload = {
    parse: {
      title: 'Рецепт:Гречка с грибами',
      revid: 12345,
      wikitext: `{{Рецепт|
|Кухня = Русская
|Порций = 2
|Время = 35 минут
|Белки = 12 г
}}
== Ингредиенты ==
* 200 г гречки
* 150 г грибов
== Приготовление ==
# Отварить гречку.
# Обжарить грибы и смешать.`,
      categories: [{ category: 'Русская_кухня' }]
    }
  };
  const recipe = mapWikibooksRecipe(payload, source, {
    pageId: 42,
    title: payload.parse.title,
    url: 'https://ru.wikibooks.org/wiki/example',
    discoveredAt: '2026-01-01T00:00:00.000Z'
  });

  assert.equal(recipe.language, 'ru');
  assert.equal(recipe.ingredients.length, 2);
  assert.equal(recipe.instructions.length, 2);
  assert.equal(recipe.sourceRevision, '12345');
  assert.equal(recipe.nutrition.protein, 12);
  assert.match(recipe.provenance.permalink, /oldid=12345/);
});

test('maps Spanish Wikibooks multiline recipe templates', () => {
  const source = { ...reusableSource, language: 'es', sourceTitle: 'Wikilibros', license: 'CC-BY-SA-4.0' };
  const recipe = mapWikibooksRecipe({
    parse: {
      title: 'Artes culinarias/Recetas/Alajú',
      revid: 123,
      categories: [{ category: 'Categoría:Recetas' }],
      wikitext: `{{Artes culinarias/Datos de receta
| comensales= 4
| tiempo = 1 hora aproximadamente.
| ingredientes =
*250 g de miel.
*150 g de almendras tostadas.
| procedimiento =
# Triturar las almendras.
# Mezclar y cocer durante diez minutos.
}}`
    }
  }, source, {
    pageId: 1,
    url: 'https://es.wikibooks.org/wiki/Artes_culinarias/Recetas/Alaj%C3%BA',
    discoveredAt: '2026-01-01T00:00:00.000Z'
  });

  assert.equal(recipe.ingredients.length, 2);
  assert.equal(recipe.instructions.length, 2);
  assert.equal(recipe.servings, 4);
  assert.equal(recipe.cookingTimeMinutes, 60);
});

test('critical QA is separate from optional completeness warnings', () => {
  const quality = assessRecipeQuality({
    title: 'Real recipe',
    ingredients: ['one', 'two'],
    instructions: ['Cook.'],
    sourceUrl: 'https://example.test/recipe',
    language: 'es',
    license: 'CC-BY-SA-4.0',
    mealType: 'dinner',
    nutrition: { calories: null, protein: null, fat: null, carbs: null }
  }, reusableSource);

  assert.deepEqual(quality.critical, []);
  assert.ok(quality.warnings.some((warning) => warning.startsWith('missing_nutrition:')));
  assert.equal(quality.eligibleForActivation, false);
});

test('extracts schema.org microdata used by culinary blogs', () => {
  const html = `
    <article itemscope itemtype="https://schema.org/Recipe">
      <h1 itemprop="name">Quinoa bowl</h1>
      <meta itemprop="totalTime" content="PT30M">
      <span itemprop="recipeYield">2 servings</span>
      <li itemprop="recipeIngredient">1 cup dry quinoa</li>
      <li itemprop="recipeIngredient">2 cups water</li>
      <ol itemprop="recipeInstructions"><li>Rinse the quinoa.</li><li>Cook until tender.</li></ol>
    </article>`;
  const recipe = extractMicrodataRecipe(html, reusableSource, {
    url: 'https://example.test/quinoa-bowl',
    discoveredAt: '2026-01-01T00:00:00.000Z'
  });

  assert.equal(recipe.title, 'Quinoa bowl');
  assert.equal(recipe.cookingTimeMinutes, 30);
  assert.equal(recipe.ingredients.length, 2);
  assert.equal(recipe.instructions.length, 2);
  assert.equal(recipe.provenance.parser, 'schema.org-microdata');
});

test('permits Nutrition.gov import only for a structured federal creator', () => {
  const source = { ...reusableSource, licenseResolver: 'us-federal-creator', allowsImport: true };
  const federal = resolveRecipeRights(source, {
    creator: { name: 'USDA Agricultural Research Service', url: 'https://www.ars.usda.gov/' }
  });
  const extension = resolveRecipeRights(source, {
    creator: { name: 'Food Hero', url: 'https://foodhero.org/' }
  });

  assert.equal(federal.license, 'US-PUBLIC-DOMAIN');
  assert.equal(federal.importAllowed, true);
  assert.equal(extension.license, 'unverified');
  assert.equal(extension.importAllowed, false);
});

test('repairs incomplete Nutrition.gov JSON-LD ingredients from visible HTML', () => {
  const repaired = repairNutritionGovRecipe({
    ingredients: ['0.25 cup'], instructions: ['Combined step'], mealType: 'lunch'
  }, `
    <div class="field__item"><span class="quantity-unit"><sup>1</sup>/<sub>4</sub> cup</span>
      <span class="ingredient-name">sugar</span></div>
    <div class="field field--name-recipe-instructions"><div class="field__item"><ol>
      <li>Mix the ingredients.</li><li>Chill before serving.</li></ol></div></div>
    <div class="field--name-recipe-course"><span>Dinner</span></div>`);
  assert.deepEqual(repaired.ingredients, ['1/4 cup sugar']);
  assert.deepEqual(repaired.instructions, ['Mix the ingredients.', 'Chill before serving.']);
  assert.equal(repaired.mealType, 'dinner');
});

test('calculates per-serving macros from measured raw ingredients', () => {
  assert.deepEqual(parseIngredientMeasurement('1 1/2 cups dry rice'), {
    raw: '1 1/2 cups dry rice', amount: 1.5, unit: 'cup', query: 'dry rice', measurable: true
  });
  const index = {
    source: 'USDA FoodData Central SR Legacy',
    sourceUrl: 'https://fdc.nal.usda.gov/',
    release: 'test',
    foods: [
      { fdcId: 1, description: 'Rice, white, long-grain, raw', nutrients: { calories: 365, protein: 7, fat: 0.7, carbs: 80, fiber: 1.3 }, portions: [] },
      { fdcId: 2, description: 'Chicken, breast, skinless, raw', nutrients: { calories: 120, protein: 22.5, fat: 2.6, carbs: 0, fiber: 0 }, portions: [] }
    ]
  };
  const recipe = estimateRecipeNutrition({
    title: 'Rice and chicken',
    servings: 2,
    ingredients: ['100 g rice', '200 g chicken breast'],
    nutrition: { calories: null, protein: null, fat: null, carbs: null },
    provenance: {},
    tags: []
  }, index);

  assert.equal(recipe.nutrition.calories, 303);
  assert.equal(recipe.nutrition.protein, 26);
  assert.equal(recipe.provenance.nutritionEstimate.status, 'calculated');
  assert.equal(recipe.provenance.nutritionEstimate.matches.length, 2);
});
