const crypto = require('crypto');

const USER_AGENT = 'nutrition-bot-recipe-research/2.0 (contact: repository-maintainer)';
const VALID_MEAL_TYPES = new Set(['breakfast', 'lunch', 'dinner']);
let mediaWikiQueue = Promise.resolve();

function scheduleMediaWikiRequest(operation) {
  const next = mediaWikiQueue
    .then(() => new Promise((resolve) => setTimeout(resolve, 1100)))
    .then(operation);
  mediaWikiQueue = next.catch(() => {});
  return next;
}

function unique(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
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

function stripWikiMarkup(value) {
  return decodeHtmlEntities(String(value || ''))
    .replace(/<!--([\s\S]*?)-->/g, ' ')
    .replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, ' ')
    .replace(/<ref\b[^>]*\/?\s*>/gi, ' ')
    .replace(/\{\{(?:[^{}]|\{\{[^{}]*\}\})*\}\}/g, ' ')
    .replace(/\[\[(?:[^\]|]+\|)?([^\]]+)\]\]/g, '$1')
    .replace(/\[(?:https?:\/\/\S+)\s+([^\]]+)\]/g, '$1')
    .replace(/'{2,5}/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseIsoDurationToMinutes(value) {
  const match = String(value || '').trim().match(/^PT(?:(\d+)H)?(?:(\d+)M)?$/i);
  if (!match) return null;
  return Number(match[1] || 0) * 60 + Number(match[2] || 0);
}

function parseDurationText(value) {
  const text = String(value || '').toLowerCase().trim();
  const hoursMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(?:hour|hours|hora|horas|час|часа|часов)/);
  const minutesMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(?:minute|minutes|minuto|minutos|минута|минуты|минут)/);
  if (hoursMatch || minutesMatch) {
    const hours = Number(String(hoursMatch?.[1] || 0).replace(',', '.'));
    const minutes = Number(String(minutesMatch?.[1] || 0).replace(',', '.'));
    return Math.round(hours * 60 + minutes);
  }
  const numbers = [...text.matchAll(/(\d+(?:[.,]\d+)?)/g)]
    .map((match) => Number(match[1].replace(',', '.')));
  if (!numbers.length) return null;
  const quantity = numbers.length > 1 ? (numbers[0] + numbers[1]) / 2 : numbers[0];
  return Math.round(quantity);
}

function parseNumber(value) {
  const match = String(value || '').replace(',', '.').match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

function normalizeInstructions(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (typeof item === 'string') return [stripHtml(item).trim()];
      if (typeof item?.text === 'string') return [stripHtml(item.text).trim()];
      if (Array.isArray(item?.itemListElement)) return normalizeInstructions(item.itemListElement);
      return [];
    }).filter(Boolean);
  }
  if (typeof value === 'string') return [stripHtml(value).trim()].filter(Boolean);
  return [];
}

function flattenJsonLd(node) {
  if (!node) return [];
  if (Array.isArray(node)) return node.flatMap(flattenJsonLd);
  if (typeof node !== 'object') return [];
  return [node, ...flattenJsonLd(node['@graph'])];
}

function extractRecipeJsonLd(html) {
  const scripts = [...String(html).matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const script of scripts) {
    try {
      const payload = JSON.parse(script[1].trim());
      const recipe = flattenJsonLd(payload).find((item) => {
        const type = item?.['@type'];
        return Array.isArray(type) ? type.includes('Recipe') : type === 'Recipe';
      });
      if (recipe) return recipe;
    } catch {}
  }
  return null;
}

function extractTitleFromHtml(html, sourceUrl) {
  const heading = String(html || '').match(/<h1[^>]*>\s*([^<]+?)\s*<\/h1>/i);
  if (heading) return decodeHtmlEntities(heading[1]).trim();
  const title = String(html || '').match(/<title[^>]*>\s*([^<]+?)\s*<\/title>/i);
  if (title) return decodeHtmlEntities(title[1]).replace(/\s*[:|-]\s*MedlinePlus.*$/i, '').trim();
  return decodeURIComponent(new URL(sourceUrl).pathname.split('/').filter(Boolean).pop() || 'recipe')
    .replace(/[-_]+/g, ' ');
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
    if (line) collected.push(line.replace(/^[•*-]\s*/, '').trim());
  }
  return collected;
}

function inferMealType(title, categories, fallback = 'lunch') {
  const text = `${title || ''} ${(categories || []).join(' ')}`.toLowerCase();
  if (/breakfast|desayuno|завтрак|овсян|омлет|сырник|каша|блин/.test(text)) return 'breakfast';
  if (/dinner|cena|ужин|жаркое|запекан|котлет|мясо|рыба/.test(text)) return 'dinner';
  return VALID_MEAL_TYPES.has(fallback) ? fallback : 'lunch';
}

function buildProvenance(source, candidate, parser, extra = {}) {
  return {
    sourceId: source.id,
    sourceTitle: source.sourceTitle,
    sourceUrl: candidate.url,
    collectionUrl: source.collectionUrl,
    language: source.language,
    parser,
    discoveredAt: candidate.discoveredAt,
    fetchedAt: new Date().toISOString(),
    licensePolicy: source.licensePolicy,
    licenseUrl: source.licenseUrl,
    ...extra
  };
}

function structuredCreator(recipe) {
  const raw = recipe?.creator || recipe?.author;
  const creators = Array.isArray(raw) ? raw : raw ? [raw] : [];
  for (const creator of creators) {
    if (typeof creator === 'string') return { name: creator, url: null };
    if (creator && typeof creator === 'object') {
      const name = creator.name || null;
      const url = typeof creator.url === 'string'
        ? creator.url
        : typeof creator['@id'] === 'string' ? creator['@id'] : null;
      if (name || url) return { name, url };
    }
  }
  return { name: null, url: null };
}

function resolveRecipeRights(source, structuredRecipe = null) {
  const creator = structuredCreator(structuredRecipe);
  if (source.licenseResolver !== 'us-federal-creator') {
    return {
      license: source.license,
      licenseUrl: source.licenseUrl,
      importAllowed: source.allowsImport !== false,
      creatorName: creator.name,
      creatorUrl: creator.url
    };
  }

  let federalCreator = false;
  if (creator.url) {
    try {
      const hostname = new URL(creator.url).hostname.toLowerCase();
      federalCreator = hostname === 'usda.gov'
        || hostname.endsWith('.usda.gov')
        || hostname === 'myplate.gov'
        || hostname.endsWith('.myplate.gov');
    } catch {}
  }
  return {
    license: federalCreator ? 'US-PUBLIC-DOMAIN' : 'unverified',
    licenseUrl: source.licenseUrl,
    importAllowed: federalCreator,
    creatorName: creator.name,
    creatorUrl: creator.url
  };
}

function baseRecipe(source, candidate, parser, extraProvenance = {}, rights = resolveRecipeRights(source)) {
  return {
    sourceType: source.sourceType,
    sourceTitle: source.sourceTitle,
    sourceUrl: candidate.url,
    language: source.language,
    license: rights.license,
    licenseUrl: rights.licenseUrl,
    sourceCheckedAt: new Date().toISOString(),
    tags: unique([...(source.tags || []), `lang:${source.language}`, `license:${rights.license}`]),
    provenance: buildProvenance(source, candidate, parser, {
      importAllowed: rights.importAllowed,
      creatorName: rights.creatorName,
      creatorUrl: rights.creatorUrl,
      ...extraProvenance
    }),
    status: 'draft'
  };
}

function mapJsonLdToRecipe(recipe, source, candidate) {
  const keywords = typeof recipe.keywords === 'string'
    ? recipe.keywords.split(',').map((item) => item.trim()).filter(Boolean)
    : Array.isArray(recipe.keywords) ? recipe.keywords.map(String) : [];
  const categories = Array.isArray(recipe.recipeCategory)
    ? recipe.recipeCategory.map(String)
    : recipe.recipeCategory ? [String(recipe.recipeCategory)] : [];
  const prep = parseIsoDurationToMinutes(recipe.prepTime);
  const cook = parseIsoDurationToMinutes(recipe.cookTime);
  const total = parseIsoDurationToMinutes(recipe.totalTime);
  const rights = resolveRecipeRights(source, recipe);
  const base = baseRecipe(source, candidate, 'schema.org/Recipe', {}, rights);
  return {
    ...base,
    title: recipe.name,
    description: stripHtml(recipe.description || ''),
    instructions: normalizeInstructions(recipe.recipeInstructions),
    servings: parseNumber(recipe.recipeYield),
    cookingTimeMinutes: total ?? ((prep || 0) + (cook || 0) || null),
    cuisine: Array.isArray(recipe.recipeCuisine) ? recipe.recipeCuisine.join(', ') : (recipe.recipeCuisine || null),
    mealType: inferMealType(recipe.name, [...categories, ...keywords], source.mealType),
    tags: unique([
      ...base.tags,
      ...keywords,
      ...categories
    ]),
    ingredients: Array.isArray(recipe.recipeIngredient) ? recipe.recipeIngredient.map(stripHtml) : [],
    nutrition: {
      calories: parseNumber(recipe.nutrition?.calories),
      protein: parseNumber(recipe.nutrition?.proteinContent),
      fat: parseNumber(recipe.nutrition?.fatContent),
      carbs: parseNumber(recipe.nutrition?.carbohydrateContent),
      fiber: parseNumber(recipe.nutrition?.fiberContent),
      portionWeight: parseNumber(recipe.nutrition?.servingSize)
    }
  };
}

function repairNutritionGovRecipe(recipe, html) {
  const normalizedHtml = String(html || '')
    .replace(/<sup[^>]*>\s*(\d+)\s*<\/sup>\s*\/\s*<sub[^>]*>\s*(\d+)\s*<\/sub>/gi, '$1/$2');
  const ingredients = [...normalizedHtml.matchAll(
    /<span\b[^>]*class=["'][^"']*quantity-unit[^"']*["'][^>]*>([\s\S]*?)<\/span>\s*<span\b[^>]*class=["'][^"']*ingredient-name[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi
  )].map((match) => `${stripHtml(match[1])} ${stripHtml(match[2])}`.replace(/\s+/g, ' ').trim());
  const instructionBlock = normalizedHtml.match(
    /field--name-recipe-instructions[\s\S]*?<div\b[^>]*class=["'][^"']*field__item[^"']*["'][^>]*>([\s\S]*?)<\/ol>/i
  )?.[1] || '';
  const instructions = [...instructionBlock.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)]
    .map((match) => stripHtml(match[1]))
    .filter(Boolean);
  const mealTypeText = normalizedHtml.match(
    /field--name-recipe-course[\s\S]*?<span[^>]*>([^<]+)<\/span>/i
  )?.[1];
  return {
    ...recipe,
    ingredients: ingredients.length ? ingredients : recipe.ingredients,
    instructions: instructions.length ? instructions : recipe.instructions,
    mealType: mealTypeText ? inferMealType(mealTypeText, [], recipe.mealType) : recipe.mealType
  };
}

function attributeValue(attributes, name) {
  const match = String(attributes || '').match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'));
  return match ? decodeHtmlEntities(match[1]).trim() : '';
}

function extractItempropRecords(html, property) {
  const records = [];
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const elementPattern = new RegExp(
    `<([a-z][a-z0-9]*)\\b([^>]*\\bitemprop\\s*=\\s*["'][^"']*\\b${escaped}\\b[^"']*["'][^>]*)>([\\s\\S]*?)<\\/\\1>`,
    'gi'
  );
  for (const match of String(html || '').matchAll(elementPattern)) {
    const attributes = match[2];
    const value = attributeValue(attributes, 'content')
      || attributeValue(attributes, 'datetime')
      || stripHtml(match[3]);
    records.push({ tag: match[1].toLowerCase(), attributes, innerHtml: match[3], value });
  }
  const metaPattern = new RegExp(
    `<(?:meta|link)\\b([^>]*\\bitemprop\\s*=\\s*["'][^"']*\\b${escaped}\\b[^"']*["'][^>]*)>`,
    'gi'
  );
  for (const match of String(html || '').matchAll(metaPattern)) {
    const value = attributeValue(match[1], 'content') || attributeValue(match[1], 'href');
    if (value) records.push({ tag: 'meta', attributes: match[1], innerHtml: '', value });
  }
  return records;
}

function extractMicrodataRecipe(html, source, candidate) {
  const ingredients = extractItempropRecords(html, 'recipeIngredient')
    .map((record) => record.value)
    .filter(Boolean);
  const instructionRecords = extractItempropRecords(html, 'recipeInstructions');
  const instructions = instructionRecords.flatMap((record) => {
    const listItems = [...record.innerHtml.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)]
      .map((match) => stripHtml(match[1]))
      .filter(Boolean);
    return listItems.length ? listItems : normalizeInstructions(record.value);
  });
  if (!ingredients.length || !instructions.length) return null;

  const value = (property) => extractItempropRecords(html, property)[0]?.value || '';
  const prep = parseIsoDurationToMinutes(value('prepTime')) ?? parseDurationText(value('prepTime'));
  const cook = parseIsoDurationToMinutes(value('cookTime')) ?? parseDurationText(value('cookTime'));
  const total = parseIsoDurationToMinutes(value('totalTime')) ?? parseDurationText(value('totalTime'));
  const title = value('name') || extractTitleFromHtml(html, candidate.url);
  const base = baseRecipe(source, candidate, 'schema.org-microdata');
  return {
    ...base,
    title,
    description: value('description'),
    instructions,
    servings: parseNumber(value('recipeYield')),
    cookingTimeMinutes: total ?? ((prep || 0) + (cook || 0) || null),
    cuisine: value('recipeCuisine') || null,
    mealType: inferMealType(title, source.tags, source.mealType),
    ingredients,
    nutrition: {
      calories: parseNumber(value('calories')),
      protein: parseNumber(value('proteinContent')),
      fat: parseNumber(value('fatContent')),
      carbs: parseNumber(value('carbohydrateContent')),
      fiber: parseNumber(value('fiberContent')),
      portionWeight: parseNumber(value('servingSize'))
    }
  };
}

function extractMedlineRecipe(html, source, candidate) {
  const lines = stripHtml(html).split('\n').map((line) => line.trim()).filter(Boolean);
  const prep = parseDurationText(findLineValue(lines, [/^Prep time:\s*(.+)$/i, /^Tiempo de preparaci[oó]n:\s*(.+)$/i]));
  const cook = parseDurationText(findLineValue(lines, [/^Cook time:\s*(.+)$/i, /^Tiempo de cocci[oó]n:\s*(.+)$/i]));
  const total = parseDurationText(findLineValue(lines, [/^Total time:\s*(.+)$/i, /^Tiempo total:\s*(.+)$/i]));
  const ingredients = collectSectionLines(
    lines,
    [/^Ingredients$/i, /^Ingredientes$/i],
    [/^Directions$/i, /^Preparation$/i, /^Preparaci[oó]n$/i, /^Nutrition/i, /^Informaci[oó]n nutricional$/i]
  );
  const instructions = collectSectionLines(
    lines,
    [/^Directions$/i, /^Preparation$/i, /^Preparaci[oó]n$/i],
    [/^Notes?:?$/i, /^Nutrition/i, /^Informaci[oó]n nutricional$/i, /^Related health topics$/i]
  ).map((line) => line.replace(/^\d+[.)]\s*/, '').trim()).filter(Boolean);
  if (!ingredients.length || !instructions.length) return null;

  const title = extractTitleFromHtml(html, candidate.url);
  return {
    ...baseRecipe(source, candidate, 'medlineplus-html'),
    title,
    description: `${source.sourceTitle} (${source.language.toUpperCase()})`,
    instructions,
    servings: parseNumber(findLineValue(lines, [/^(?:Number of )?Servings:\s*(.+)$/i, /^Porciones:\s*(.+)$/i])),
    cookingTimeMinutes: total ?? ((prep || 0) + (cook || 0) || null),
    cuisine: null,
    mealType: inferMealType(title, source.tags, source.mealType),
    ingredients,
    nutrition: {
      calories: parseNumber(findLineValue(lines, [/^Calories\s+(.+)$/i, /^Calor[ií]as\s+(.+)$/i])),
      protein: parseNumber(findLineValue(lines, [/^Protein(?:s)?\s+(.+)$/i, /^Prote[ií]nas\s+(.+)$/i])),
      fat: parseNumber(findLineValue(lines, [/^Total Fat\s+(.+)$/i, /^Grasa Total\s+(.+)$/i])),
      carbs: parseNumber(findLineValue(lines, [/^Total Carbohydrate\s+(.+)$/i, /^Carbohidrato Total\s+(.+)$/i])),
      fiber: parseNumber(findLineValue(lines, [/^Dietary Fiber\s+(.+)$/i, /^Fibra Diet[eé]tica\s+(.+)$/i])),
      portionWeight: parseNumber(findLineValue(lines, [/^Serving size\s+(.+)$/i, /^Tamaño por raci[oó]n\s+(.+)$/i]))
    }
  };
}

function extractTemplateValue(wikitext, name) {
  const pattern = new RegExp(`\\|\\s*${name}\\s*=\\s*([^\\n|}]*)`, 'i');
  return stripWikiMarkup(wikitext.match(pattern)?.[1] || '');
}

function extractFirstTemplateValue(wikitext, names) {
  for (const name of names) {
    const value = extractTemplateValue(wikitext, name);
    if (value) return value;
  }
  return '';
}

function extractWikiMetric(wikitext, names) {
  const templateValue = extractFirstTemplateValue(wikitext, names);
  if (templateValue) return parseNumber(templateValue);
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = String(wikitext || '').match(new RegExp(`(?:^|[|*])\\s*${escaped}\\s*[:=]\\s*([^\\n|]+)`, 'im'));
    if (match) return parseNumber(stripWikiMarkup(match[1]));
  }
  return null;
}

function extractWikiSection(wikitext, names) {
  const escaped = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const match = String(wikitext || '').match(new RegExp(`^={2,4}\\s*(?:${escaped})\\s*={2,4}\\s*$([\\s\\S]*?)(?=^={2,4}[^=].*?={2,4}\\s*$|(?![\\s\\S]))`, 'im'));
  return match?.[1] || '';
}

function wikiLines(value) {
  return String(value || '').split('\n')
    .map((line) => line.replace(/^\s*[#*:;]+\s*/, ''))
    .map(stripWikiMarkup)
    .filter((line) => line.length >= 3);
}

function mapWikibooksRecipe(payload, source, candidate) {
  const parsed = payload?.parse;
  const wikitext = typeof parsed?.wikitext === 'string' ? parsed.wikitext : parsed?.wikitext?.['*'];
  if (!wikitext) return null;
  const categoryRecords = (parsed.categories || []).map((item) => ({
    name: String(item.category || item['*'] || item.title || '')
      .replace(/^Категория:/i, '')
      .replace(/_/g, ' '),
    hidden: Boolean(item.hidden)
  }));
  const categories = categoryRecords.map((item) => item.name);
  const title = String(parsed.title || candidate.title || '')
    .replace(/^Рецепт:/i, '')
    .replace(/^Cookbook:/i, '')
    .replace(/^Artes culinarias\/Recetas\//i, '')
    .trim();
  const templateIngredients = extractFirstTemplateValue(wikitext, ['Ингредиенты', 'ingredients', 'ingredientes']);
  const ingredientSection = extractWikiSection(wikitext, [
    'Ингредиенты', 'Состав', 'Ingredients', 'Ingredient', 'Ingredientes'
  ]);
  const instructionSection = extractWikiSection(wikitext, [
    'Приготовление',
    'Способ приготовления',
    'Процесс приготовления',
    'Рецепт', 'Procedure', 'Directions', 'Preparation', 'Method', 'Preparación', 'Elaboración', 'Procedimiento'
  ]);
  const categoryIngredients = categoryRecords
    .filter((item) => !item.hidden)
    .map((item) => item.name)
    .filter((name) => !/кухня$|рецепт|блюда|кулинар|закуск|соус|суп|салат|десерт|выпечк|cuisine$|recipes?|cookbook|recetas?|cocina$|platos?|postres?/i.test(name));
  const ingredients = ingredientSection
    ? wikiLines(ingredientSection)
    : templateIngredients
      ? templateIngredients.split(/[,;]+/).map(stripWikiMarkup).filter(Boolean)
      : categoryIngredients;
  const fallbackInstructionSection = String(wikitext)
    .replace(/\{\{Рецепт[\s\S]*?\}\}/i, '')
    .match(/^==[^=].*?==\s*$([\s\S]*?)(?=^==[^=].*?==\s*$|(?![\s\S]))/im)?.[1] || '';
  const instructions = wikiLines(instructionSection || fallbackInstructionSection);
  const cuisine = extractFirstTemplateValue(wikitext, ['Кухня', 'cuisine', 'cocina'])
    || categories.find((category) => /кухня$|cuisine$|cocina$/i.test(category))
    || null;
  const revision = parsed.revid ? String(parsed.revid) : null;
  const permalink = revision
    ? `${candidate.url}?oldid=${encodeURIComponent(revision)}`
    : candidate.url;
  const base = baseRecipe(source, candidate, 'mediawiki-wikitext', {
    pageId: candidate.pageId,
    revisionId: revision,
    permalink,
    attribution: parsed.title
  });

  return {
    ...base,
    title,
    description: wikiLines(wikitext.replace(/\{\{Рецепт[\s\S]*?\}\}/i, '').split(/^==/m)[0]).join(' ').slice(0, 1000),
    instructions,
    servings: parseNumber(extractFirstTemplateValue(wikitext, ['Порций', 'servings', 'yield', 'porciones'])),
    cookingTimeMinutes: parseDurationText(extractFirstTemplateValue(wikitext, ['Время', 'time', 'total time', 'tiempo'])),
    difficulty: extractFirstTemplateValue(wikitext, ['Сложность', 'difficulty', 'dificultad']) || null,
    cuisine,
    mealType: inferMealType(title, categories, source.mealType),
    sourceRevision: revision,
    ingredients,
    tags: unique([...base.tags, ...categories.slice(0, 20)]),
    nutrition: {
      calories: extractWikiMetric(wikitext, ['Энергетическая ценность', 'calories', 'calorías']),
      protein: extractWikiMetric(wikitext, ['белки', 'protein', 'proteínas']),
      fat: extractWikiMetric(wikitext, ['жиры', 'fat', 'grasa']),
      carbs: extractWikiMetric(wikitext, ['углеводы', 'carbohydrates', 'carbs', 'carbohidratos']),
      fiber: extractWikiMetric(wikitext, ['клетчатка', 'fiber', 'fibra']),
      portionWeight: null
    }
  };
}

function computeContentHash(recipe) {
  const stable = JSON.stringify({
    title: String(recipe.title || '').toLowerCase().trim(),
    ingredients: (recipe.ingredients || []).map((item) => String(item.name || item).toLowerCase().trim()).sort(),
    instructions: (recipe.instructions || []).map((item) => String(item).toLowerCase().replace(/\s+/g, ' ').trim())
  });
  return crypto.createHash('sha256').update(stable).digest('hex');
}

function assessRecipeQuality(recipe, source) {
  const critical = [];
  const warnings = [];
  if (!String(recipe.title || '').trim()) critical.push('missing_title');
  if (!VALID_MEAL_TYPES.has(recipe.mealType)) critical.push('invalid_meal_type');
  if ((recipe.ingredients || []).length < 2) critical.push('insufficient_ingredients');
  if ((recipe.instructions || []).length < 1) critical.push('missing_instructions');
  if (!recipe.sourceUrl) critical.push('missing_source_url');
  if (!recipe.language) critical.push('missing_language');
  if (!recipe.license) critical.push('missing_license');

  if (!recipe.cookingTimeMinutes) warnings.push('missing_cooking_time');
  if (!recipe.servings) warnings.push('missing_servings');
  if (!recipe.cuisine) warnings.push('missing_cuisine');
  const macros = ['calories', 'protein', 'fat', 'carbs'];
  const missingMacros = macros.filter((key) => recipe.nutrition?.[key] === null || recipe.nutrition?.[key] === undefined);
  if (missingMacros.length) warnings.push(`missing_nutrition:${missingMacros.join(',')}`);
  if (!source.allowsAutomaticActivation) warnings.push('license_requires_manual_review');

  const completenessChecks = [
    recipe.cookingTimeMinutes,
    recipe.servings,
    recipe.cuisine,
    recipe.nutrition?.calories,
    recipe.nutrition?.protein,
    recipe.nutrition?.fat,
    recipe.nutrition?.carbs
  ];
  const optionalComplete = completenessChecks.filter((value) => value !== null && value !== undefined && value !== '').length;
  const score = Math.max(0, Math.round((70 - critical.length * 25 + optionalComplete / completenessChecks.length * 30) * 100) / 100);
  const eligibleForActivation = critical.length === 0
    && missingMacros.length === 0
    && Boolean(recipe.cookingTimeMinutes)
    && Boolean(source.allowsAutomaticActivation)
    && recipe.provenance?.importAllowed !== false;
  return { score, critical, warnings, eligibleForActivation };
}

function finalizeRecipe(recipe, source, activateEligible = false) {
  const quality = assessRecipeQuality(recipe, source);
  return {
    ...recipe,
    contentHash: computeContentHash(recipe),
    qualityScore: quality.score,
    qualityReport: quality,
    status: activateEligible && quality.eligibleForActivation ? 'active' : 'draft'
  };
}

async function fetchWithRetry(url, options = {}) {
  const retries = Math.max(0, Number(options.retries ?? 2));
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { 'user-agent': USER_AGENT, accept: options.accept || 'text/html,application/json' },
        signal: AbortSignal.timeout(Number(options.timeoutMs) || 20000)
      });
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.status = response.status;
        error.retryAfter = Number(response.headers.get('retry-after')) || null;
        throw error;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        const retryMs = error.status === 429
          ? Math.max(3000 * (attempt + 1), Number(error.retryAfter || 0) * 1000)
          : 250 * (2 ** attempt);
        await new Promise((resolve) => setTimeout(resolve, retryMs));
      }
    }
  }
  throw new Error(`Failed to fetch ${url}: ${lastError?.message || 'unknown error'}`);
}

function discoverHtmlLinks(html, collectionUrl) {
  const base = new URL(collectionUrl);
  const blocked = new Set([
    'breakfast', 'lunch', 'dinner', 'desserts', 'breads', 'dairy-free', 'dips-salsas-and-sauces',
    'drinks', 'gluten-sensitive', 'low-fat', 'low-sodium', 'salads', 'side-dishes', 'snacks', 'soups',
    'vegetarian', 'desayuno', 'almuerzo', 'cena', 'postres', 'acompanamientos', 'bajo-en-grasa',
    'bajo-en-sodio', 'bebidas', 'bocadillos', 'ensaladas', 'pan', 'salsas-y-aderezos', 'sin-gluten',
    'sin-lacteos', 'sopas', 'vegetariana'
  ]);
  return unique([...String(html).matchAll(/href\s*=\s*["']([^"']+)["']/gi)]
    .map((match) => {
      try { return new URL(match[1], base).toString(); } catch { return null; }
    })
    .filter((url) => url && new URL(url).host === base.host)
    .filter((url) => /\/recipes\/.+\/?(?:[?#].*)?$/i.test(url) || /\/spanish\/recetas\/.+\/?(?:[?#].*)?$/i.test(url))
    .filter((url) => !blocked.has(new URL(url).pathname.split('/').filter(Boolean).pop()?.toLowerCase())));
}

function discoverSitemapLinks(xml, source) {
  const prefix = source.urlPrefix || source.collectionUrl;
  return unique([...String(xml || '').matchAll(/<loc>\s*([\s\S]*?)\s*<\/loc>/gi)]
    .map((match) => decodeHtmlEntities(match[1]).trim())
    .filter((url) => url.startsWith(prefix) && url.replace(/\/+$/, '') !== prefix.replace(/\/+$/, '')));
}

async function discoverMediaWiki(source, limit) {
  const candidates = [];
  let continuation;
  let limitReached = false;
  do {
    const url = new URL(source.apiUrl);
    const useNamespace = source.namespace !== undefined;
    url.search = new URLSearchParams(useNamespace ? {
      action: 'query', format: 'json', formatversion: '2', list: 'allpages',
      apnamespace: String(source.namespace), aplimit: '500',
      ...(continuation ? { apcontinue: continuation } : {})
    } : {
      action: 'query', format: 'json', formatversion: '2', list: 'categorymembers',
      cmtitle: source.categoryTitle, cmtype: 'page', cmlimit: '500',
      ...(continuation ? { cmcontinue: continuation } : {})
    });
    const payload = await scheduleMediaWikiRequest(async () => {
      const response = await fetchWithRetry(url, { accept: 'application/json', retries: 4 });
      return response.json();
    });
    const pages = useNamespace ? payload.query?.allpages : payload.query?.categorymembers;
    for (const page of pages || []) {
      candidates.push({
        url: `${new URL(source.apiUrl).origin}/wiki/${encodeURIComponent(page.title.replace(/ /g, '_')).replace(/%2F/gi, '/')}`,
        pageId: page.pageid,
        title: page.title,
        discoveredAt: new Date().toISOString()
      });
      if (limit > 0 && candidates.length >= limit) {
        limitReached = true;
        break;
      }
    }
    continuation = useNamespace ? payload.continue?.apcontinue : payload.continue?.cmcontinue;
  } while (continuation && !limitReached);

  for (let offset = 0; offset < candidates.length; offset += 50) {
    const batch = candidates.slice(offset, offset + 50);
    const url = new URL(source.apiUrl);
    url.search = new URLSearchParams({
      action: 'query', format: 'json', formatversion: '2', prop: 'revisions|categories',
      pageids: batch.map((candidate) => candidate.pageId).join('|'),
      rvprop: 'ids|content', rvslots: 'main', cllimit: 'max'
    });
    const payload = await scheduleMediaWikiRequest(async () => {
      const response = await fetchWithRetry(url, { accept: 'application/json', retries: 4 });
      return response.json();
    });
    const pagesById = new Map((payload.query?.pages || []).map((page) => [page.pageid, page]));
    for (const candidate of batch) {
      const page = pagesById.get(candidate.pageId);
      const revision = page?.revisions?.[0];
      const wikitext = revision?.slots?.main?.content;
      if (!page || !wikitext) continue;
      candidate.wikiPayload = {
        parse: {
          title: page.title,
          pageid: page.pageid,
          revid: revision.revid,
          categories: page.categories || [],
          wikitext
        }
      };
    }
  }
  return candidates;
}

async function discoverSourceCandidates(source, limit = 0) {
  const effectiveLimit = limit > 0 ? limit : Number(source.defaultLimit || 0);
  if (source.discovery === 'mediawiki-category') return discoverMediaWiki(source, effectiveLimit);
  if (source.discovery === 'sitemap') {
    const xml = await (await fetchWithRetry(source.sitemapUrl)).text();
    const links = discoverSitemapLinks(xml, source);
    const selected = effectiveLimit > 0 ? links.slice(0, effectiveLimit) : links;
    return selected.map((url) => ({ url, discoveredAt: new Date().toISOString() }));
  }

  const pageCount = Math.max(1, Number(source.pagination?.pages || 1));
  const links = [];
  for (let page = 0; page < pageCount; page++) {
    const collectionUrl = new URL(source.collectionUrl);
    if (source.pagination?.parameter) collectionUrl.searchParams.set(source.pagination.parameter, String(page));
    const html = await (await fetchWithRetry(collectionUrl)).text();
    links.push(...discoverHtmlLinks(html, collectionUrl));
  }
  const filteredLinks = unique(links).filter((url) => !source.urlPrefix || url.startsWith(source.urlPrefix));
  const selected = effectiveLimit > 0 ? filteredLinks.slice(0, effectiveLimit) : filteredLinks;
  return selected.map((url) => ({ url, discoveredAt: new Date().toISOString() }));
}

async function fetchAndMapCandidate(source, candidate, options = {}) {
  let recipe;
  if (source.discovery === 'mediawiki-category') {
    let payload = candidate.wikiPayload;
    if (!payload) {
      const url = new URL(source.apiUrl);
      url.search = new URLSearchParams({
        action: 'parse', format: 'json', formatversion: '2', pageid: String(candidate.pageId),
        prop: 'wikitext|categories|revid'
      });
      payload = await scheduleMediaWikiRequest(async () => {
        const response = await fetchWithRetry(url, options);
        return response.json();
      });
    }
    recipe = mapWikibooksRecipe(payload, source, candidate);
  } else {
    const html = await (await fetchWithRetry(candidate.url, options)).text();
    const jsonLd = extractRecipeJsonLd(html);
    recipe = jsonLd
      ? mapJsonLdToRecipe(jsonLd, source, candidate)
      : extractMicrodataRecipe(html, source, candidate)
        || extractMedlineRecipe(html, source, candidate);
    if (recipe && source.sourceType === 'web_nutrition_gov') {
      recipe = repairNutritionGovRecipe(recipe, html);
    }
  }
  return recipe ? finalizeRecipe(recipe, source, options.activateEligible) : null;
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length || 1) }, run));
  return results;
}

module.exports = {
  assessRecipeQuality,
  discoverSourceCandidates,
  extractMedlineRecipe,
  extractMicrodataRecipe,
  extractRecipeJsonLd,
  fetchAndMapCandidate,
  finalizeRecipe,
  mapJsonLdToRecipe,
  mapWikibooksRecipe,
  mapWithConcurrency,
  parseDurationText,
  repairNutritionGovRecipe,
  resolveRecipeRights,
  stripHtml,
  stripWikiMarkup
};
