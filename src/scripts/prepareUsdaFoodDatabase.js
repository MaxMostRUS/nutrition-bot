const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const DATASET_URL = 'https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip';
const DEFAULT_OUTPUT = path.resolve('.cache/usda-fooddata/sr-legacy-index.json');
const NUTRIENT_KEYS = new Map([
  [1008, 'calories'],
  [1003, 'protein'],
  [1004, 'fat'],
  [1005, 'carbs'],
  [1079, 'fiber']
]);

function parseCsvLine(line) {
  const values = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      values.push(value);
      value = '';
    } else {
      value += character;
    }
  }
  values.push(value);
  return values;
}

function readCsv(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines.shift());
  return lines.map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index]]));
  });
}

async function downloadFile(url, destination) {
  const response = await fetch(url, { headers: { 'user-agent': 'nutrition-bot-recipe-research/2.0' } });
  if (!response.ok) throw new Error(`USDA dataset download failed with HTTP ${response.status}`);
  fs.writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
}

async function buildIndex(outputPath = DEFAULT_OUTPUT) {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'nutrition-usda-'));
  const archivePath = path.join(tempDirectory, 'usda.zip');
  const extractPath = path.join(tempDirectory, 'data');
  fs.mkdirSync(extractPath);

  try {
    await downloadFile(DATASET_URL, archivePath);
    execFileSync('unzip', ['-q', archivePath, '-d', extractPath]);
    const datasetDirectory = path.join(extractPath, fs.readdirSync(extractPath)[0]);
    const foods = new Map(readCsv(path.join(datasetDirectory, 'food.csv')).map((row) => [row.fdc_id, {
      fdcId: Number(row.fdc_id),
      description: row.description,
      nutrients: {},
      portions: []
    }]));
    const units = new Map(readCsv(path.join(datasetDirectory, 'measure_unit.csv')).map((row) => [row.id, row.name]));

    for (const row of readCsv(path.join(datasetDirectory, 'food_nutrient.csv'))) {
      const key = NUTRIENT_KEYS.get(Number(row.nutrient_id));
      const food = foods.get(row.fdc_id);
      if (key && food && food.nutrients[key] === undefined) food.nutrients[key] = Number(row.amount);
    }
    for (const row of readCsv(path.join(datasetDirectory, 'food_portion.csv'))) {
      const food = foods.get(row.fdc_id);
      if (!food || !Number(row.gram_weight)) continue;
      food.portions.push({
        amount: Number(row.amount) || 1,
        unit: units.get(row.measure_unit_id) || null,
        description: row.portion_description || row.modifier || null,
        grams: Number(row.gram_weight)
      });
    }

    const payload = {
      source: 'USDA FoodData Central SR Legacy',
      sourceUrl: DATASET_URL,
      release: '2018-04',
      generatedAt: new Date().toISOString(),
      foods: [...foods.values()].filter((food) => (
        food.nutrients.calories !== undefined
        && food.nutrients.protein !== undefined
        && food.nutrients.fat !== undefined
        && food.nutrients.carbs !== undefined
      ))
    };
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(payload)}\n`);
    return { outputPath, foodCount: payload.foods.length };
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
}

if (require.main === module) {
  buildIndex(process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_OUTPUT)
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = { DATASET_URL, DEFAULT_OUTPUT, buildIndex, parseCsvLine };
