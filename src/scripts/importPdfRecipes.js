const db = require('../services/db');
const JSON5 = require('json5');
const { askChatGPT } = require('../services/openaiService');
const { importRecipeBatch } = require('../services/recipeImportService');

function parseArgs(argv) {
  const args = {};
  for (const item of argv) {
    if (!item.startsWith('--')) continue;
    const [key, value] = item.slice(2).split('=');
    args[key] = value === undefined ? true : value;
  }
  return args;
}

function parseMealTypes(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => ['breakfast', 'lunch', 'dinner'].includes(item));
}

function looksLikeRecipePage(text) {
  const sample = String(text || '').toLowerCase();
  return /(ingredients|directions|instructions|method|prep time|cook time|serves|yield|cups?|tbsp|teaspoon|oven|bake|mix|recipe)/.test(sample);
}

function parseJsonResponse(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {}

  try {
    return JSON5.parse(raw);
  } catch {}

  try {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      const candidate = raw.slice(start, end + 1);
      try {
        return JSON.parse(candidate);
      } catch {
        return JSON5.parse(candidate);
      }
    }
  } catch {}

  return null;
}

function groupPages(rows) {
  const pageMap = new Map();

  for (const row of rows) {
    const key = Number(row.page_number);
    const current = pageMap.get(key) || [];
    current.push(String(row.content || '').trim());
    pageMap.set(key, current);
  }

  return Array.from(pageMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([pageNumber, items]) => ({
      pageNumber,
      content: items.filter(Boolean).join('\n\n').trim()
    }))
    .filter((page) => page.content);
}

function buildWindows(pages) {
  const windows = [];

  for (let index = 0; index < pages.length; index++) {
    const current = pages[index];
    if (!looksLikeRecipePage(current.content)) continue;

    const next = pages[index + 1];
    const merged = next && next.content.length < 1800
      ? `${current.content}\n\n${next.content}`.slice(0, 5000)
      : current.content.slice(0, 5000);

    windows.push({
      pageNumbers: next && merged.includes(next.content)
        ? [current.pageNumber, next.pageNumber]
        : [current.pageNumber],
      content: merged
    });
  }

  return windows;
}

function scoreWindowForMealTypes(window, mealTypes) {
  if (!mealTypes.length) return 0;

  const text = String(window.content || '').toLowerCase();
  const breakfastHints = /(breakfast|pancake|waffle|omelet|omelette|oatmeal|granola|frittata|eggs?)/g;
  const lunchDinnerHints = /(soup|salad|bowl|casserole|chili|pasta|rice|quinoa|salmon|tilapia|chicken|turkey|beef|tofu|lentil|bean|stew|stuffed|rolls|tacos|burrito|cabbage)/g;

  let score = 0;
  if (mealTypes.includes('breakfast')) {
    score += (text.match(breakfastHints) || []).length * 3;
  }
  if (mealTypes.includes('lunch') || mealTypes.includes('dinner')) {
    score += (text.match(lunchDinnerHints) || []).length * 3;
    score -= (text.match(breakfastHints) || []).length * 2;
  }

  return score;
}

async function extractRecipesFromWindow(document, window, preferredMealTypes) {
  const preferredText = preferredMealTypes.length
    ? `Focus on these meal types first: ${preferredMealTypes.join(', ')}.`
    : 'Return breakfast, lunch, or dinner recipes only.';
  const prompt = [
    {
      role: 'system',
      content: [
        'You extract cookbook recipes into structured JSON.',
        'Return only recipes explicitly present in the text.',
        'Skip non-recipe content, tips, indexes, sauces/drinks/desserts that are not suitable for a weekly nutrition menu.',
        preferredText,
        'If nutrition or cooking time is missing, estimate conservatively from ingredients and steps.',
        'Output valid JSON only with this shape: {"recipes":[...]}'
      ].join(' ')
    },
    {
      role: 'user',
      content: [
        `Book: ${document.title}`,
        `Pages: ${window.pageNumbers.join(', ')}`,
        'Extract up to 4 menu-suitable recipes from the text below.',
        'Each recipe must have:',
        '- title',
        '- description',
        '- mealType (breakfast|lunch|dinner)',
        '- cuisine (or null)',
        '- cookingTimeMinutes',
        '- servings',
        '- tags (include "estimated-macros" and/or "estimated-time" if you had to infer them)',
        '- ingredients: [{name, amount, unit, note, optional}]',
        '- instructions: string[]',
        '- nutrition: {calories, protein, fat, carbs, fiber, portionWeight}',
        '',
        window.content
      ].join('\n')
    }
  ];

  const raw = await askChatGPT(prompt, {
    temperature: 0.1,
    json: true,
    max_tokens: 1800,
    retries: 2
  });

  const parsed = parseJsonResponse(raw);
  return Array.isArray(parsed?.recipes) ? parsed.recipes : [];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const onlyTitle = args.title ? String(args.title).toLowerCase() : null;
  const maxWindows = Math.max(1, Number(args.maxWindows) || 9999);
  const skipWindows = Math.max(0, Number(args.skipWindows) || 0);
  const preferredMealTypes = parseMealTypes(args.mealTypes);

  try {
    const documents = await db.query(
      `SELECT id, title, file_path, source_type, metadata
       FROM knowledge_documents
       WHERE source_type = 'pdf_recipe_book'
       ORDER BY id ASC`
    );

    let totalImported = 0;

    for (const document of documents.rows) {
      if (onlyTitle && !String(document.title).toLowerCase().includes(onlyTitle)) continue;

      console.log(`Importing PDF recipes from ${document.title}`);

      const chunks = await db.query(
        `SELECT page_number, chunk_index, content
         FROM knowledge_chunks
         WHERE document_id = $1
         ORDER BY page_number ASC, chunk_index ASC`,
        [document.id]
      );

      const pages = groupPages(chunks.rows);
      const windows = buildWindows(pages)
        .sort((a, b) => scoreWindowForMealTypes(b, preferredMealTypes) - scoreWindowForMealTypes(a, preferredMealTypes))
        .slice(skipWindows, skipWindows + maxWindows);
      let importedFromDocument = 0;

      for (const window of windows) {
        try {
          const recipes = await extractRecipesFromWindow(document, window, preferredMealTypes);
          const filteredRecipes = preferredMealTypes.length
            ? recipes.filter((recipe) => preferredMealTypes.includes(String(recipe?.mealType || '').toLowerCase()))
            : recipes;
          if (!filteredRecipes.length) continue;

          const saved = await importRecipeBatch(filteredRecipes, {
            sourceType: 'pdf_book_recipe',
            sourceTitle: document.title,
            sourceUrl: document.file_path,
            license: 'user-uploaded-book',
            tags: Array.isArray(document.metadata?.tags) ? document.metadata.tags : []
          });

          importedFromDocument += saved.length;
          totalImported += saved.length;
          console.log(`Pages ${window.pageNumbers.join(', ')} -> ${saved.length} recipes`);
        } catch (error) {
          console.warn(`PDF window import failed for ${document.title} pages ${window.pageNumbers.join(', ')}: ${error.message}`);
        }
      }

      console.log(`Imported/updated ${importedFromDocument} recipes from ${document.title}`);
    }

    console.log(`PDF recipe import completed. Imported/updated ${totalImported} recipes total.`);
  } catch (error) {
    console.error('PDF recipe import failed:', error);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
}

main();
