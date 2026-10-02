const webRecipeSources = require('../data/webRecipeSources');
const { importRecipeBatch } = require('../services/recipeImportService');
const db = require('../services/db');

function parseArgs(argv) {
  const args = {};
  for (const item of argv) {
    if (!item.startsWith('--')) continue;
    const [key, value] = item.slice(2).split('=');
    args[key] = value === undefined ? true : value;
  }
  return args;
}

function unique(values) {
  return Array.from(new Set(values));
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function stripHtml(html) {
  return decodeHtmlEntities(
    String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6]|\/section|\/article)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function parseIsoDurationToMinutes(value) {
  const text = String(value || '').trim();
  const match = text.match(/^PT(?:(\d+)H)?(?:(\d+)M)?$/i);
  if (!match) return null;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  return hours * 60 + minutes;
}

function parseServings(value) {
  const text = String(value || '').trim();
  const match = text.match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

function parseNutritionNumber(value) {
  const text = String(value || '').replace(',', '.');
  const match = text.match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

function parseDurationText(value) {
  const text = String(value || '').toLowerCase().trim();
  if (!text) return null;

  const numbers = [...text.matchAll(/(\d+(?:\.\d+)?)/g)].map((match) => Number(match[1]));
  if (!numbers.length) return null;

  const quantity = numbers.length > 1 ? (numbers[0] + numbers[1]) / 2 : numbers[0];

  if (/\b(hour|hours|hora|horas)\b/.test(text)) {
    return Math.round(quantity * 60);
  }

  return Math.round(quantity);
}

function flattenJsonLd(node) {
  if (!node) return [];
  if (Array.isArray(node)) return node.flatMap(flattenJsonLd);
  if (typeof node !== 'object') return [];
  const items = [node];
  if (Array.isArray(node['@graph'])) {
    items.push(...flattenJsonLd(node['@graph']));
  }
  return items;
}

function extractRecipeJsonLd(html) {
  const scripts = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];

  for (const script of scripts) {
    try {
      const payload = JSON.parse(script[1].trim());
      const recipe = flattenJsonLd(payload).find((item) => {
        const type = item?.['@type'];
        if (Array.isArray(type)) return type.includes('Recipe');
        return type === 'Recipe';
      });
      if (recipe) return recipe;
    } catch {}
  }

  return null;
}

function normalizeInstructions(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (typeof item === 'string') return [item.trim()];
      if (typeof item?.text === 'string') return [item.text.trim()];
      if (Array.isArray(item?.itemListElement)) return normalizeInstructions(item.itemListElement);
      return [];
    }).filter(Boolean);
  }
  if (typeof value === 'string') return [value.trim()];
  if (typeof value?.text === 'string') return [value.text.trim()];
  return [];
}

function parsePortionWeight(value) {
  const text = String(value || '').replace(',', '.');
  const match = text.match(/\((\d+(?:\.\d+)?)\s*g\)/i) || text.match(/(\d+(?:\.\d+)?)\s*g\b/i);
  return match ? Number(match[1]) : null;
}

function extractTitleFromHtml(html, sourceUrl) {
  const headingMatch = String(html || '').match(/<h1[^>]*>\s*([^<]+?)\s*<\/h1>/i);
  if (headingMatch) return decodeHtmlEntities(headingMatch[1]).trim();

  const titleMatch = String(html || '').match(/<title[^>]*>\s*([^<]+?)\s*<\/title>/i);
  if (titleMatch) {
    return decodeHtmlEntities(titleMatch[1])
      .replace(/\s*[:|-]\s*MedlinePlus.*$/i, '')
      .trim();
  }

  const slug = new URL(sourceUrl).pathname.split('/').filter(Boolean).pop() || 'recipe';
  return slug
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function findLineValue(lines, patterns) {
  for (const line of lines) {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) return match[1]?.trim() || '';
    }
  }
  return '';
}

function collectSectionLines(lines, startPatterns, stopPatterns) {
  const startIndex = lines.findIndex((line) => startPatterns.some((pattern) => pattern.test(line)));
  if (startIndex === -1) return [];

  const collected = [];
  for (let index = startIndex + 1; index < lines.length; index++) {
    const line = lines[index];
    if (stopPatterns.some((pattern) => pattern.test(line))) break;
    if (!line) continue;
    collected.push(line.replace(/^[•*-]\s*/, '').trim());
  }
  return collected;
}

function isMenuSuitableRecipe(candidate, source) {
  const title = String(candidate.title || candidate.name || '').toLowerCase();
  const categories = normalizeInstructions([
    ...(Array.isArray(candidate.tags) ? candidate.tags : []),
    ...(Array.isArray(candidate.recipeCategory) ? candidate.recipeCategory : candidate.recipeCategory ? [candidate.recipeCategory] : []),
    ...(Array.isArray(candidate.keywords) ? candidate.keywords : typeof candidate.keywords === 'string' ? candidate.keywords.split(',') : [])
  ]).map((item) => String(item).toLowerCase());

  const haystack = `${title} ${categories.join(' ')}`;
  const mealDishHints = /\b(omelet|omelette|oatmeal|toast|waffle|pancake|quesadilla|taquito|frittata|hash|bowl|soup|salad|taco|tacos|burrito|casserole|chili|stew|pasta|rice|quinoa|chicken|turkey|beef|fish|salmon|tilapia|tofu|lentil|bean|meatball|enchilada|lasagna|burger|pizza|pollo|pescado|salmon|tilapia|tofu|frijol|frijoles|lenteja|lentejas|arroz|ensalada|sopa|alb[oó]ndiga|alb[oó]ndigas|enchilada|cazuela|chile|guisado|pozole|pupusa|salteado|salm[oó]n)\b/;
  const nonMenuHints = /\b(dressing|aderezo|sauce|dip|beverage|drink|smoothie|batido|juice|jugo|cocktail|dessert|postre)\b/;

  if (nonMenuHints.test(title) && !mealDishHints.test(title)) return false;
  if (/\b(side dish|side|accompaniment|acompañamiento)\b/.test(haystack) && !mealDishHints.test(title)) return false;
  if (source.mealType === 'breakfast' && /\b(french toast|oatmeal|waffle|pancake|toast|burrito|casserole|quesadilla)\b/.test(title)) return true;
  if (/\b(salsa)\b/.test(title) && !mealDishHints.test(title)) return false;
  if (mealDishHints.test(title)) return true;
  if (source.mealType !== 'breakfast' && /\b(soup|salad|sopa|ensalada)\b/.test(title)) return true;

  return true;
}

function mapJsonLdToRecipe(recipe, source, sourceUrl) {
  const keywords = typeof recipe.keywords === 'string'
    ? recipe.keywords.split(',').map((item) => item.trim()).filter(Boolean)
    : Array.isArray(recipe.keywords)
      ? recipe.keywords.map((item) => String(item).trim()).filter(Boolean)
      : [];

  const categories = Array.isArray(recipe.recipeCategory)
    ? recipe.recipeCategory
    : recipe.recipeCategory
      ? [recipe.recipeCategory]
      : [];

  const mapped = {
    title: recipe.name,
    description: recipe.description || '',
    instructions: normalizeInstructions(recipe.recipeInstructions),
    servings: parseServings(recipe.recipeYield),
    cookingTimeMinutes: parseIsoDurationToMinutes(recipe.totalTime)
      ?? (parseIsoDurationToMinutes(recipe.prepTime) || 0) + (parseIsoDurationToMinutes(recipe.cookTime) || 0),
    cuisine: recipe.recipeCuisine || null,
    mealType: source.mealType,
    sourceType: source.sourceType,
    sourceTitle: source.sourceTitle,
    sourceUrl,
    license: 'open-web',
    tags: unique([
      ...source.tags,
      `lang:${source.language}`,
      ...keywords,
      ...categories.map((item) => String(item).trim())
    ]),
    ingredients: Array.isArray(recipe.recipeIngredient) ? recipe.recipeIngredient : [],
    nutrition: {
      calories: parseNutritionNumber(recipe.nutrition?.calories),
      protein: parseNutritionNumber(recipe.nutrition?.proteinContent),
      fat: parseNutritionNumber(recipe.nutrition?.fatContent),
      carbs: parseNutritionNumber(recipe.nutrition?.carbohydrateContent),
      fiber: parseNutritionNumber(recipe.nutrition?.fiberContent),
      portionWeight: null
    },
    status: 'active'
  };

  mapped.status = isMenuSuitableRecipe(mapped, source) ? 'active' : 'draft';
  return mapped;
}

function extractMedlinePlusRecipe(html, source, sourceUrl) {
  const text = stripHtml(html);
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);

  const prep = parseDurationText(findLineValue(lines, [/^Prep time:\s*(.+)$/i, /^Tiempo de preparación:\s*(.+)$/i]));
  const cook = parseDurationText(findLineValue(lines, [/^Cook time:\s*(.+)$/i, /^Tiempo de cocción:\s*(.+)$/i]));
  const total = parseDurationText(findLineValue(lines, [/^Total time:\s*(.+)$/i, /^Tiempo total:\s*(.+)$/i]));
  const servings = parseServings(findLineValue(lines, [/^Servings:\s*(.+)$/i, /^Porciones:\s*(.+)$/i]));
  const portionWeight = parsePortionWeight(findLineValue(lines, [/^Serving size\s+(.+)$/i, /^Tamaño por ración\s+(.+)$/i]));
  const ingredients = collectSectionLines(
    lines,
    [/^Ingredients$/i, /^Ingredientes$/i],
    [/^Preparation$/i, /^Preparación$/i, /^Nutrition/i, /^Información nutricional$/i, /^Related health topics$/i, /^Temas de salud relacionados$/i]
  );
  const preparationLines = collectSectionLines(
    lines,
    [/^Preparation$/i, /^Preparación$/i],
    [/^Notes:?$/i, /^Nutrition/i, /^Información nutricional$/i, /^Related health topics$/i, /^Temas de salud relacionados$/i]
  );

  const instructions = preparationLines
    .map((line) => line.replace(/^\d+\.\s*/, '').trim())
    .filter(Boolean);

  if (!ingredients.length || !instructions.length) return null;

  const mapped = {
    title: extractTitleFromHtml(html, sourceUrl),
    description: `${source.sourceTitle} (${source.language.toUpperCase()})`.trim(),
    instructions,
    servings,
    cookingTimeMinutes: (total ?? ((prep || 0) + (cook || 0))) || null,
    cuisine: null,
    mealType: source.mealType,
    sourceType: source.sourceType,
    sourceTitle: source.sourceTitle,
    sourceUrl,
    license: 'open-web',
    tags: unique([
      ...source.tags,
      `lang:${source.language}`,
      'html-extracted'
    ]),
    ingredients,
    nutrition: {
      calories: parseNutritionNumber(findLineValue(lines, [/^Calories\s+(.+)$/i, /^Calorías\s+(.+)$/i])),
      protein: parseNutritionNumber(findLineValue(lines, [/^Protein(?:s)?\s+(.+)$/i, /^Proteínas\s+(.+)$/i])),
      fat: parseNutritionNumber(findLineValue(lines, [/^Total Fat\s+(.+)$/i, /^Grasa Total\s+(.+)$/i])),
      carbs: parseNutritionNumber(findLineValue(lines, [/^Total Carbohydrate\s+(.+)$/i, /^Carbohidrato Total\s+(.+)$/i])),
      fiber: parseNutritionNumber(findLineValue(lines, [/^Dietary Fiber\s+(.+)$/i, /^Fibra Dietética\s+(.+)$/i])),
      portionWeight
    },
    status: 'active'
  };

  mapped.status = isMenuSuitableRecipe(mapped, source) ? 'active' : 'draft';
  return mapped;
}

function discoverRecipeLinks(html, collectionUrl) {
  const base = new URL(collectionUrl);
  const blockedCollectionSlugs = [
    'breakfast',
    'lunch',
    'dinner',
    'desserts',
    'breads',
    'dairy-free',
    'dips-salsas-and-sauces',
    'drinks',
    'gluten-sensitive',
    'low-fat',
    'low-sodium',
    'salads',
    'side-dishes',
    'snacks',
    'soups',
    'vegetarian',
    'desayuno',
    'almuerzo',
    'cena',
    'postres',
    'acompanamientos',
    'bajo-en-grasa',
    'bajo-en-sodio',
    'bebidas',
    'bocadillos',
    'ensaladas',
    'pan',
    'salsas-y-aderezos',
    'sin-gluten',
    'sin-lacteos',
    'sopas',
    'vegetariana'
  ];
  const links = [...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)]
    .map((match) => match[1])
    .map((href) => {
      try {
        return new URL(href, base).toString();
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter((href) => href.startsWith(`${base.protocol}//${base.host}`))
    .filter((href) => /\/recipes\/.+\/$/i.test(href) || /\/spanish\/recetas\/.+\/$/i.test(href))
    .filter((href) => href !== collectionUrl)
    .filter((href) => {
      const slug = new URL(href).pathname.split('/').filter(Boolean).pop() || '';
      return !blockedCollectionSlugs.includes(slug.toLowerCase());
    });

  return unique(links);
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'nutrition-bot-recipe-import/1.0'
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  return response.text();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceFilter = args.source ? String(args.source) : null;
  const maxPerCollection = Math.max(1, Number(args.limitPerCollection) || 12);

  try {
    let importedCount = 0;

    for (const source of webRecipeSources) {
      if (sourceFilter && source.id !== sourceFilter) continue;

      console.log(`Discovering recipes from ${source.collectionUrl}`);
      const collectionHtml = await fetchHtml(source.collectionUrl);
      const recipeLinks = discoverRecipeLinks(collectionHtml, source.collectionUrl).slice(0, maxPerCollection);
      console.log(`Found ${recipeLinks.length} candidate links for ${source.id}`);

      for (const recipeUrl of recipeLinks) {
        try {
          const html = await fetchHtml(recipeUrl);
          const jsonLdRecipe = extractRecipeJsonLd(html);
          const mapped = jsonLdRecipe
            ? mapJsonLdToRecipe(jsonLdRecipe, source, recipeUrl)
            : extractMedlinePlusRecipe(html, source, recipeUrl);
          if (!mapped) {
            console.warn(`Skipping ${recipeUrl}: structured recipe data not found`);
            continue;
          }

          const saved = await importRecipeBatch([mapped], {
            sourceType: source.sourceType,
            sourceTitle: source.sourceTitle,
            sourceUrl: recipeUrl,
            tags: source.tags
          });

          if (saved.length > 0) {
            importedCount += saved.length;
            console.log(`Imported web recipe: ${mapped.title}`);
          }
        } catch (error) {
          console.warn(`Web recipe import failed for ${recipeUrl}: ${error.message}`);
        }
      }
    }

    console.log(`Web recipe import completed. Imported/updated ${importedCount} recipes.`);
  } catch (error) {
    console.error('Web recipe import failed:', error);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
}

main();
