const fs = require('fs');
const path = require('path');

const DEFAULT_INDEX_PATH = path.resolve('.cache/usda-fooddata/sr-legacy-index.json');
const UNIT_ALIASES = new Map([
  ['g', 'gram'], ['gram', 'gram'], ['grams', 'gram'], ['г', 'gram'],
  ['kg', 'kilogram'], ['kilogram', 'kilogram'], ['kilograms', 'kilogram'], ['кг', 'kilogram'],
  ['oz', 'ounce'], ['ounce', 'ounce'], ['ounces', 'ounce'],
  ['lb', 'pound'], ['lbs', 'pound'], ['pound', 'pound'], ['pounds', 'pound'],
  ['cup', 'cup'], ['cups', 'cup'],
  ['tbsp', 'tablespoon'], ['tablespoon', 'tablespoon'], ['tablespoons', 'tablespoon'],
  ['tsp', 'teaspoon'], ['teaspoon', 'teaspoon'], ['teaspoons', 'teaspoon'],
  ['ml', 'milliliter'], ['milliliter', 'milliliter'], ['milliliters', 'milliliter'],
  ['can', 'can'], ['cans', 'can'],
  ['large', 'large'], ['medium', 'medium'], ['small', 'small'],
  ['clove', 'clove'], ['cloves', 'clove'], ['piece', 'piece'], ['pieces', 'piece'],
  ['slice', 'slice'], ['slices', 'slice'], ['stalk', 'stalk'], ['stalks', 'stalk']
]);
const STOP_WORDS = new Set(['and', 'or', 'of', 'the', 'a', 'an', 'for', 'to', 'taste', 'as', 'needed']);
const MINOR_INGREDIENT = /\b(?:water|salt|pepper|spice|seasoning|herb|parsley|cilantro|basil|oregano|thyme|cinnamon|vanilla)\b/i;

function parseMixedNumber(value) {
  return String(value || '').trim().split(/\s+/).reduce((total, part) => {
    if (part.includes('/')) {
      const [numerator, denominator] = part.split('/').map(Number);
      return total + (denominator ? numerator / denominator : 0);
    }
    return total + Number(part || 0);
  }, 0);
}

function parseIngredientMeasurement(rawIngredient) {
  const raw = String(rawIngredient?.name || rawIngredient || '')
    .replace(/[¼]/g, ' 1/4').replace(/[\u00bd]/g, ' 1/2').replace(/[\u00be]/g, ' 3/4')
    .replace(/[\u2153]/g, ' 1/3').replace(/[\u2154]/g, ' 2/3')
    .replace(/\s+/g, ' ').trim();
  const amountMatch = raw.match(/^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)\b\s*/);
  if (!amountMatch) return { raw, amount: null, unit: null, query: raw, measurable: false };
  const amount = parseMixedNumber(amountMatch[1]);
  let remainder = raw.slice(amountMatch[0].length).trim();
  const unitMatch = remainder.match(/^([A-Za-zА-Яа-яЁё]+)\.?\s*/);
  const rawUnit = unitMatch?.[1]?.toLowerCase() || '';
  const unit = UNIT_ALIASES.get(rawUnit) || null;
  if (unit) remainder = remainder.slice(unitMatch[0].length).trim();
  const parentheticalText = [...remainder.matchAll(/\(([^)]*)\)/g)].map((match) => match[1]).join(' ');
  const states = [...parentheticalText.matchAll(/\b(?:raw|cooked|dry|dried|drained|canned|nonfat|green|yellow|red|white)\b/gi)]
    .map((match) => match[0].toLowerCase());
  const query = `${remainder
    .replace(/\([^)]*\)/g, ' ')
    .replace(/,.*$/, '')
    .replace(/\b(?:finely|roughly|thinly|freshly|chopped|diced|minced|sliced|divided|optional)\b/gi, ' ')
    .replace(/\s+/g, ' ').trim()} ${states.join(' ')}`.trim();
  return { raw, amount, unit, query, measurable: amount > 0 && Boolean(query) };
}

function normalizeSearchText(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\bbell peppers?\b/g, 'sweet pepper')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

function singularizeToken(token) {
  if (/[^s]ies$/.test(token)) return `${token.slice(0, -3)}y`;
  if (/(?:ch|sh|x|ss)es$/.test(token)) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

function searchTokens(value) {
  return normalizeSearchText(value).split(' ')
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
    .map(singularizeToken);
}

function scoreFoodMatch(query, food) {
  const normalizedQuery = normalizeSearchText(query);
  const normalizedDescription = normalizeSearchText(food.description);
  const queryTokens = searchTokens(normalizedQuery);
  if (!queryTokens.length) return 0;
  const descriptionTokens = new Set(searchTokens(normalizedDescription));
  const primaryTokens = searchTokens(String(food.description).split(',')[0]);
  const matched = queryTokens.filter((token) => descriptionTokens.has(token)).length;
  const primaryMatched = primaryTokens.filter((token) => queryTokens.includes(token)).length;
  let score = matched / queryTokens.length + (primaryTokens.length ? primaryMatched / primaryTokens.length * 0.45 : 0);
  if (primaryTokens.length === queryTokens.length && primaryMatched === queryTokens.length) score += 0.55;
  if (normalizedDescription.startsWith(`${normalizedQuery} `) || normalizedDescription === normalizedQuery) score += 0.2;
  if (normalizedQuery === 'olive oil' && normalizedDescription.startsWith('oil olive ')) score += 0.5;
  if (normalizedDescription.includes(normalizedQuery)) score += 0.2;
  const requestedDry = /\b(?:dry|dried|uncooked)\b/.test(normalizedQuery);
  const requestedRaw = /\braw\b/.test(normalizedQuery);
  if (requestedDry && /\b(?:dry|dried|uncooked)\b/.test(normalizedDescription)) score += 0.25;
  if (requestedRaw && /\braw\b/.test(normalizedDescription)) score += 0.25;
  if (!requestedDry && !requestedRaw && /\b(?:cooked|boiled|fried|roasted|baked)\b/.test(normalizedDescription)) score -= 0.2;
  if (!requestedDry && !requestedRaw && /\b(?:raw|dry|uncooked)\b/.test(normalizedDescription)) score += 0.08;
  return score;
}

function findBestFood(query, foods) {
  let best = null;
  for (const food of foods) {
    const score = scoreFoodMatch(query, food);
    if (!best || score > best.score) best = { food, score };
  }
  return best && best.score >= 0.78 ? best : null;
}

function gramsForMeasurement(measurement, food) {
  if (measurement.unit === 'gram') return measurement.amount;
  if (measurement.unit === 'kilogram') return measurement.amount * 1000;
  if (measurement.unit === 'ounce') return measurement.amount * 28.3495;
  if (measurement.unit === 'pound') return measurement.amount * 453.592;

  const wanted = normalizeSearchText(measurement.unit || '');
  if (!wanted) return null;
  const wantedTokens = new Set([wanted]);
  if (wanted === 'tablespoon') wantedTokens.add('tbsp');
  if (wanted === 'teaspoon') wantedTokens.add('tsp');
  if (wanted === 'milliliter') wantedTokens.add('ml');
  const portion = (food.portions || []).map((candidate) => {
    const text = normalizeSearchText(`${candidate.unit || ''} ${candidate.description || ''}`);
    let score = text.split(' ').some((token) => wantedTokens.has(token)) ? 2 : 0;
    if (wanted === 'piece' && /\b(?:piece|item)\b/.test(text)) score = 2;
    return { candidate, score };
  }).sort((left, right) => right.score - left.score)[0];
  if (!portion || portion.score === 0) return null;
  return measurement.amount * portion.candidate.grams / (portion.candidate.amount || 1);
}

function findBestFoodForMeasurement(measurement, foods) {
  let best = null;
  for (const food of foods) {
    const score = scoreFoodMatch(measurement.query, food);
    if (score < 0.78) continue;
    const grams = gramsForMeasurement(measurement, food);
    if (!grams) continue;
    if (!best || score > best.score) best = { food, score, grams };
  }
  return best;
}

function isMinorUnresolved(measurement) {
  if (!MINOR_INGREDIENT.test(measurement.query || measurement.raw)) return false;
  if (!measurement.amount) return true;
  return ['teaspoon', 'tablespoon', null].includes(measurement.unit) && measurement.amount <= 2;
}

function loadFoodIndex(indexPath = DEFAULT_INDEX_PATH) {
  if (!fs.existsSync(indexPath)) {
    throw new Error(`USDA food index not found: ${indexPath}. Run npm run prepare:usda-foods first.`);
  }
  return JSON.parse(fs.readFileSync(indexPath, 'utf8'));
}

function estimateRecipeNutrition(recipe, index) {
  const existing = recipe.nutrition || {};
  const missingFields = ['calories', 'protein', 'fat', 'carbs']
    .filter((field) => existing[field] === null || existing[field] === undefined);
  if (!missingFields.length) return recipe;
  const servings = Number(recipe.servings);
  if (!Number.isFinite(servings) || servings <= 0) {
    return { ...recipe, provenance: { ...recipe.provenance, nutritionEstimate: { status: 'skipped', reason: 'missing_servings' } } };
  }

  const totals = { calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0, portionWeight: 0 };
  const matches = [];
  const unresolved = [];
  for (const ingredient of recipe.ingredients || []) {
    const measurement = parseIngredientMeasurement(ingredient);
    if (!measurement.measurable) {
      if (!isMinorUnresolved(measurement)) unresolved.push({ ingredient: measurement.raw, reason: 'missing_quantity' });
      continue;
    }
    const match = findBestFoodForMeasurement(measurement, index.foods || []);
    if (!match) {
      if (!isMinorUnresolved(measurement)) unresolved.push({ ingredient: measurement.raw, reason: 'food_or_portion_not_matched' });
      continue;
    }
    const grams = match.grams;
    const factor = grams / 100;
    for (const field of ['calories', 'protein', 'fat', 'carbs', 'fiber']) {
      totals[field] += Number(match.food.nutrients[field] || 0) * factor;
    }
    totals.portionWeight += grams;
    matches.push({
      ingredient: measurement.raw,
      query: measurement.query,
      fdcId: match.food.fdcId,
      food: match.food.description,
      grams: Math.round(grams * 10) / 10,
      matchScore: Math.round(match.score * 100) / 100
    });
  }

  if (unresolved.length || !matches.length) {
    return {
      ...recipe,
      provenance: {
        ...recipe.provenance,
        nutritionEstimate: {
          status: 'skipped',
          reason: unresolved.length ? 'unresolved_major_ingredients' : 'no_measurable_ingredients',
          matchedIngredients: matches.length,
          unresolved
        }
      }
    };
  }

  const estimated = {
    calories: Math.round(totals.calories / servings),
    protein: Math.round(totals.protein / servings * 10) / 10,
    fat: Math.round(totals.fat / servings * 10) / 10,
    carbs: Math.round(totals.carbs / servings * 10) / 10,
    fiber: Math.round(totals.fiber / servings * 10) / 10,
    portionWeight: Math.round(totals.portionWeight / servings)
  };
  return {
    ...recipe,
    nutrition: { ...estimated, ...Object.fromEntries(Object.entries(existing).filter(([, value]) => value !== null && value !== undefined)) },
    tags: Array.from(new Set([...(recipe.tags || []), 'nutrition:estimated-usda'])),
    provenance: {
      ...recipe.provenance,
      nutritionEstimate: {
        status: 'calculated',
        source: index.source,
        sourceUrl: index.sourceUrl,
        release: index.release,
        basis: 'per-serving',
        servings,
        filledFields: missingFields,
        matchedIngredients: matches.length,
        matches
      }
    }
  };
}

module.exports = {
  DEFAULT_INDEX_PATH,
  estimateRecipeNutrition,
  findBestFood,
  findBestFoodForMeasurement,
  gramsForMeasurement,
  loadFoodIndex,
  parseIngredientMeasurement,
  scoreFoodMatch
};
