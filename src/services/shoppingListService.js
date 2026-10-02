const escapeHtml = require('../utils/escapeHtml');

const UNIT_RULES = [
    { pattern: /^(?:ст\.?\s*л\.?(?:ожк(?:а|и)?)?|столов(?:ая|ые)?\s+ложк(?:а|и)?)(?=\s|$)/i, unit: 'ст.л.' },
    { pattern: /^(?:ч\.?\s*л\.?(?:ожк(?:а|и)?)?|чайн(?:ая|ые)?\s+ложк(?:а|и)?)(?=\s|$)/i, unit: 'ч.л.' },
    { pattern: /^(?:зубчик(?:а|ов)?|зуб\.?)(?=\s|$)/i, unit: 'зубчик' },
    { pattern: /^(?:грамм(?:а|ов)?|гр\.?|г)(?=\s|$)/i, unit: 'г' },
    { pattern: /^(?:килограмм(?:а|ов)?|кг)(?=\s|$)/i, unit: 'кг' },
    { pattern: /^(?:миллилитр(?:а|ов)?|мл)(?=\s|$)/i, unit: 'мл' },
    { pattern: /^(?:литр(?:а|ов)?|л)(?=\s|$)/i, unit: 'л' },
    { pattern: /^(?:штук(?:и)?|шт\.?)(?=\s|$)/i, unit: 'шт' }
];

const INGREDIENT_FORMS = {
    'индейка': { measured: 'индейки' },
    'куриная грудка': { measured: 'куриной грудки' },
    'куриный бульон': { measured: 'куриного бульона' },
    'рыба': { measured: 'рыбы' },
    'филе индейки': { measured: 'филе индейки' },
    'болгарский перец': { measured: 'болгарского перца' },
    'брокколи': { measured: 'брокколи' },
    'картофель': { measured: 'картофеля' },
    'лук': { measured: 'лука', one: 'луковица', few: 'луковицы', many: 'луковиц' },
    'морковь': { measured: 'моркови' },
    'помидоры': { measured: 'помидоров' },
    'помидоры черри': { measured: 'помидоров черри' },
    'чеснок': { measured: 'чеснока' },
    'шпинат': { measured: 'шпината' },
    'лимон': { measured: 'лимона', one: 'лимон', few: 'лимона', many: 'лимонов' },
    'ягоды': { measured: 'ягод' },
    'киноа': { measured: 'киноа' },
    'овсяные хлопья': { measured: 'овсяных хлопьев' },
    'греческий йогурт': { measured: 'греческого йогурта' },
    'молоко': { measured: 'молока' },
    'сыр': { measured: 'сыра' },
    'творог': { measured: 'творога' },
    'яйца': { one: 'яйцо', few: 'яйца', many: 'яиц' },
    'орехи': { measured: 'орехов' },
    'ванильный сахар': { measured: 'ванильного сахара' },
    'ванильный экстракт': { measured: 'ванильного экстракта' },
    'корица': { measured: 'корицы' },
    'мед': { measured: 'меда' },
    'оливковое масло': { measured: 'оливкового масла' },
    'сахар': { measured: 'сахара' },
    'разрыхлитель': { measured: 'разрыхлителя' },
    'семена чиа': { measured: 'семян чиа' }
};

// Утилиты нормализации текста
function preprocessRaw(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[–—]/g, '-')
        .replace(/¼/g, '1/4')
        .replace(/½/g, '1/2')
        .replace(/¾/g, '3/4')
        .replace(/(\d)\s*\/\s*(\d)/g, '$1/$2')
        .replace(/(\d),(\d)/g, '$1.$2')
        .replace(/\(по желанию\)/gi, '')
        .replace(/по желанию/gi, '')
        .replace(/по вкусу/gi, '')
        .replace(/\s*\(.*?\)/g, '') // убираем скобочные уточнения
        .replace(/ст\.?\s*л\.?/gi, 'ст.л.')
        .replace(/ч\.?\s*л\.?/gi, 'ч.л.')
        .replace(/ст\.л\.?ожк(?:а|и)?/gi, 'ст.л.')
        .replace(/ч\.л\.?ожк(?:а|и)?/gi, 'ч.л.')
        .replace(/ст\.л\.?\s*ложк(?:а|и)?/gi, 'ст.л.')
        .replace(/ч\.л\.?\s*ложк(?:а|и)?/gi, 'ч.л.')
        .replace(/столов(?:ая|ые)\s+ложк(?:а|и)/gi, 'ст.л.')
        .replace(/чайн(?:ая|ые)\s+ложк(?:а|и)/gi, 'ч.л.')
        .replace(/\s+/g, ' ')
        .trim();
}

function parseFraction(str) {
    // Преобразует 1/2, 3/4 в десятичное число
    const m = str.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (!m) return null;
    const num = parseFloat(m[1]);
    const den = parseFloat(m[2]);
    if (!den) return null;
    return num / den;
}

function parseAmount(value) {
    const normalized = String(value || '').trim();

    if (/^\d+\s+\d+\/\d+$/.test(normalized)) {
        const [whole, fraction] = normalized.split(/\s+/);
        const fractionValue = parseFraction(fraction);
        return fractionValue === null ? Number(whole) : Number(whole) + fractionValue;
    }

    if (/^\d+\/\d+$/.test(normalized)) {
        return parseFraction(normalized);
    }

    const parsed = Number(normalized.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
}

function pluralizeCount(amount, one, few, many) {
    const abs = Math.abs(Number(amount) || 0);
    const mod100 = abs % 100;
    const mod10 = abs % 10;

    if (mod100 >= 11 && mod100 <= 14) return many;
    if (mod10 === 1) return one;
    if (mod10 >= 2 && mod10 <= 4) return few;
    return many;
}

function getIngredientForms(name) {
    return INGREDIENT_FORMS[name] || null;
}

function normalizeName(name) {
    let n = preprocessRaw(name);

    // Убираем лишние слова и служебные хвосты
    n = n.replace(/\b(свеж[а-я]*|отварн[а-я]*|запеченн[а-я]*|консервированн[а-я]*|тушен[а-я]*)\b/g, ' ');
    n = n.replace(/\b(для посыпки|для подачи)\b/g, ' ');

    // Синонимы и унификация
    n = n.replace(/куриное?\s+филе|курин[а-я]*\s+грудк[а-я]*/g, 'куриная грудка');
    n = n.replace(/филе\s+индейк[а-я]*/g, 'филе индейки');
    n = n.replace(/филе\s+треск[а-я]*/g, 'филе трески');
    n = n.replace(/лосос[а-я]*/g, 'филе лосося');
    n = n.replace(/тунец.*консерв/i, 'тунец консервированный');
    n = n.replace(/рыб[а-я]*/g, 'рыба');
    n = n.replace(/филе\s+белой\s+рыб[а-я]*/g, 'рыба');
    n = n.replace(/филе\s+рыб[а-я]*/g, 'рыба');
    n = n.replace(/греческ[а-я]*\s+йогурт[а-я]*/g, 'греческий йогурт');
    n = n.replace(/вод[а-я]*\s+или\s+молок[а-я]*/g, 'молоко');
    n = n.replace(/мед[а-я]*\s+или\s+кленов(?:ого)?\s+сироп[а-я]*/g, 'мед');
    n = n.replace(/свеж[а-я]*\s+шпинат[а-я]*/g, 'шпинат');
    n = n.replace(/свеж[а-я]*\s+ягод[а-я]*/g, 'ягоды');

    n = n.replace(/овсян[а-я]*\s+хлопь[а-я]*/g, 'овсяные хлопья');
    n = n.replace(/кин[оа]а/gi, 'киноа');
    n = n.replace(/гречк[а-я]*/g, 'гречка');
    n = n.replace(/картофел[а-я]*/g, 'картофель');
    n = n.replace(/помидор[а-я]*\s*черри/g, 'помидоры черри');
    n = n.replace(/помидор[а-я]*/g, 'помидоры');
    n = n.replace(/шпинат[а-я]*/g, 'шпинат');
    n = n.replace(/брокколи[а-я]*/g, 'брокколи');
    n = n.replace(/лук\s+красн[а-я]*/g, 'лук красный');
    n = n.replace(/луковиц[а-я]*/g, 'лук');
    n = n.replace(/лук[а-я]*/g, 'лук');
    n = n.replace(/огурц[а-я]*/g, 'огурец');
    n = n.replace(/чеснок[а-я]*/g, 'чеснок');
    n = n.replace(/морков[а-я]*/g, 'морковь');
    n = n.replace(/болгарск[а-я]*\s+пер(?:ец|ца|цу|цем|це)/g, 'болгарский перец');
    n = n.replace(/сладк[а-я]*\s+пер(?:ец|ца|цу|цем|це)/g, 'болгарский перец');
    n = n.replace(/^овощи.*$/g, 'овощи смешанные');
    n = n.replace(/соль.*перец.*/g, 'соль и перец');
    n = n.replace(/лимонный сок|сок\s+лимон[а-я]*/g, 'лимон');
    n = n.replace(/лимон\s+для\s+подачи/g, 'лимон');
    n = n.replace(/смешанн[а-я]*\s+ягод[а-я]*/g, 'ягоды');
    n = n.replace(/ягод[а-я]*/g, 'ягоды');
    n = n.replace(/ягодыы/g, 'ягоды');
    n = n.replace(/яйц(?:о|а)?/g, 'яйца');
    n = n.replace(/сыр[а-я]*/g, 'сыр');
    n = n.replace(/творог[а-я]*/g, 'творог');
    n = n.replace(/йогурт[а-я]*/g, 'йогурт');
    n = n.replace(/оливков[а-я]*\s+масл[а-я]*/g, 'оливковое масло');
    n = n.replace(/м[её]д[а-я]*/gi, 'мед');
    n = n.replace(/кленового сиропа/g, 'кленовый сироп');
    n = n.replace(/кориц[а-я]*/g, 'корица');
    n = n.replace(/орех[а-я]*/g, 'орехи');
    n = n.replace(/миндал[а-я]*/g, 'миндаль');
    n = n.replace(/куриного?\s+бульон[а-я]*/g, 'куриный бульон');
    n = n.replace(/семян\s+чиа|семена?\s+чиа/g, 'семена чиа');
    n = n.replace(/щепотка\s+соли/g, 'соль');
    n = n.replace(/щепотка\s+кориц[а-я]*/g, 'корица');
    n = n.replace(/\s+/g, ' ').trim();

    return n;
}

// Обработка ингредиентов: нормализация и агрегация
function normalizeIngredient(ingredient) {
    const raw = preprocessRaw(ingredient);

    if (!raw) {
        return { amount: 0, unit: '', name: '' };
    }

    const amountMatch = raw.match(/^(\d+(?:\.\d+)?(?:\/\d+)?(?:\s+\d+\/\d+)?)\s+(.+)$/);
    if (!amountMatch) {
        return { amount: 0, unit: '', name: normalizeName(raw) };
    }

    const amount = parseAmount(amountMatch[1]);
    let rest = amountMatch[2].trim();
    let unit = '';

    for (const rule of UNIT_RULES) {
        const match = rest.match(rule.pattern);
        if (!match) continue;

        unit = rule.unit;
        rest = rest.slice(match[0].length).trim();
        break;
    }

    const name = normalizeName(rest || raw);

    if (name === 'соль' || name === 'перец' || name === 'соль и перец' || name === 'специи') {
        return { amount: 0, unit: '', name };
    }

    return {
        amount: amount === null ? 0 : amount,
        unit,
        name
    };
}

function aggregateIngredients(ingredients) {
    const groups = new Map();
    
    for (const ing of ingredients) {
        const norm = normalizeIngredient(ing);
        
        // Пропускаем пустые названия
        if (!norm.name || norm.name === 'единица') continue;
        
        // Специальная обработка для специй и приправ
        if (['соль', 'перец', 'специи', 'соль и перец'].includes(norm.name)) {
            norm.amount = 0;
            norm.unit = '';
        }
        
        const key = `${norm.name}|${norm.unit}`;
        if (groups.has(key)) {
            groups.get(key).amount += norm.amount;
        } else {
            groups.set(key, { ...norm });
        }
    }
    
    return Array.from(groups.values());
}

function categorizeIngredients(aggregated) {
    const categories = {
        'Мясо и рыба': [],
        'Овощи': [],
        'Фрукты и ягоды': [],
        'Зерновые и крупы': [],
        'Молочные продукты': [],
        'Яйца': [],
        'Орехи и семена': [],
        'Масла и приправы': [],
        'Прочее': []
    };
    
    for (const item of aggregated) {
        const name = item.name.toLowerCase();
        let category = 'Прочее';

        if (['соль', 'перец', 'соль и перец', 'специи', 'корица'].includes(name)) {
            category = 'Масла и приправы';
        } else if (/курин|индейк|говяд|свинин|баранин|рыб|лосос|треск|тунец|филе/i.test(name)) {
            category = 'Мясо и рыба';
        } else if (/брокколи|морков|картофел|перец|лук|чеснок|шпинат|помидор|огурец|салат|горошек|фасоль|цукини|капуст/i.test(name)) {
            category = 'Овощи';
        } else if (/ягод|яблок|банан|апельсин|лимон|авокадо|клубник|малин|черник/i.test(name)) {
            category = 'Фрукты и ягоды';
        } else if (/овсян|гречк|рис|киноа|хлопь|крупа|мук/i.test(name)) {
            category = 'Зерновые и крупы';
        } else if (/молок|творог|сыр|йогурт|кефир/i.test(name)) {
            category = 'Молочные продукты';
        } else if (/яйц|яйко/i.test(name)) {
            category = 'Яйца';
        } else if (/орех|семеч|миндал/i.test(name)) {
            category = 'Орехи и семена';
        } else if (/масло|мед|сахар|уксус|приправ|паприк|ваниль|кленовый сироп/i.test(name)) {
            category = 'Масла и приправы';
        }
        
        categories[category].push(item);
    }
    
    return categories;
}

function formatShoppingList(categories) {
    let result = '';
    
    for (const [catName, items] of Object.entries(categories)) {
        if (items.length === 0) continue;
        
        result += `<b>${escapeHtml(catName)}</b>\n`;
        
        // Сортируем по имени
        const sorted = items.slice().sort((a,b) => a.name.localeCompare(b.name));
        
        // Дополнительная агрегация внутри категории
        const finalAggregated = new Map();
        for (const it of sorted) {
            const key = `${it.name}|${it.unit}`;
            if (!finalAggregated.has(key)) {
                finalAggregated.set(key, { ...it });
            } else {
                finalAggregated.get(key).amount += it.amount;
            }
        }
        
        // Форматируем и выводим
        for (const it of finalAggregated.values()) {
            const roundedAmount = Number.isInteger(it.amount)
                ? it.amount
                : Math.round(it.amount * 10) / 10;
            const forms = getIngredientForms(it.name);

            let line = it.name;

            if (it.amount > 0) {
                if (!it.unit) {
                    if (forms?.one && forms?.few && forms?.many) {
                        line = `${roundedAmount} ${pluralizeCount(roundedAmount, forms.one, forms.few, forms.many)}`;
                    } else {
                        line = `${roundedAmount} ${it.name}`;
                    }
                } else if (it.unit === 'шт') {
                    if (forms?.one && forms?.few && forms?.many) {
                        line = `${roundedAmount} ${pluralizeCount(roundedAmount, forms.one, forms.few, forms.many)}`;
                    } else {
                        line = `${roundedAmount} шт ${it.name}`;
                    }
                } else if (it.unit === 'зубчик' && it.name === 'чеснок') {
                    line = `${roundedAmount} зубч. чеснока`;
                } else {
                    line = `${roundedAmount} ${it.unit} ${forms?.measured || it.name}`;
                }
            }

            result += ` • ${escapeHtml(line)}\n`;
        }
        
        result += '\n';
    }
    
    return result.trim();
}

async function generateShoppingListFromMeals(meals) {
    console.log('Generating shopping list from', meals.length, 'meals');
    
    const allIngredients = [];
    for (const meal of meals) {
        if (!meal.recipe) {
            console.log('No recipe found for meal:', meal.name);
            continue;
        }

        let recipeData;
        try {
            recipeData = typeof meal.recipe === 'string'
                ? JSON.parse(meal.recipe)
                : meal.recipe;
            console.log('Successfully parsed recipe for meal:', meal.name);
        } catch (err) {
            console.error('Error parsing recipe for meal:', meal.name, err);
            recipeData = { ingredients: [], steps: [], cookingTimeMinutes: 0 };
        }

        if (Array.isArray(recipeData.ingredients)) {
            allIngredients.push(...recipeData.ingredients);
            console.log('Added', recipeData.ingredients.length, 'ingredients from meal:', meal.name);
        } else {
            console.log('No ingredients array found in recipe for meal:', meal.name);
        }
    }

    if (allIngredients.length === 0) {
        console.log('No ingredients found in any meals');
        return 'Список покупок пуст. Нет доступных ингредиентов.';
    }

    console.log('Total ingredients collected:', allIngredients.length);

    // Локальная обработка: агрегация и категоризация
    const aggregated = aggregateIngredients(allIngredients);
    const categorized = categorizeIngredients(aggregated);
    const result = formatShoppingList(categorized);

    console.log('Generated shopping list with local processing');
    return result || 'Список покупок пуст.';
}

module.exports = {
    generateShoppingListFromMeals
};
