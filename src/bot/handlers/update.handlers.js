const userController = require('../../controllers/userController');
const { getMainMenuKeyboard } = require('../../keyboards');
const { calculateBMR, activityFactor, adjustCaloriesForGoal, calculateMacros } = require('../../services/macrosService');

const FIELD_NAMES = {
  age: 'возраст',
  gender: 'пол',
  weight: 'вес',
  height: 'рост',
  activity: 'уровень активности',
  goal: 'цель'
};

function registerUpdateHandlers(bot) {
  bot.action('update_all', async (ctx) => {
    await ctx.answerCbQuery();
    ctx.reply('📝 Давайте обновим все ваши данные по порядку.');
    ctx.scene.enter('registerScene');
  });

  bot.action('cancel_update', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('❌ Обновление отменено.', getMainMenuKeyboard());
  });

  bot.action(/update_(age|gender|weight|height|activity|goal)/, async (ctx) => {
    const field = ctx.match[1];
    await ctx.answerCbQuery();
    if (field === 'goal') {
      await ctx.reply('📝 Выберите новую цель:', {
        reply_markup: {
          inline_keyboard: [
            [ { text: 'Сброс веса', callback_data: 'goal_lose' }, { text: 'Поддержание', callback_data: 'goal_maintain' } ],
            [ { text: 'Набор веса', callback_data: 'goal_gain' } ]
          ]
        }
      });
    } else if (field === 'activity') {
      await ctx.reply('📝 Выберите новый уровень активности:', {
        reply_markup: {
          inline_keyboard: [
            [ { text: 'Низкий', callback_data: 'activity_low' }, { text: 'Средний', callback_data: 'activity_medium' } ],
            [ { text: 'Высокий', callback_data: 'activity_high' } ]
          ]
        }
      });
    } else {
      await ctx.reply(`📝 Введите новый ${FIELD_NAMES[field]}:`);
    }
    if (!ctx.session) ctx.session = {};
    ctx.session.updateField = field;
    ctx.session.waitingForUpdate = true;
  });

  bot.action(/goal_(lose|maintain|gain)/, async (ctx) => {
    const goal = ctx.match[1];
    await ctx.answerCbQuery();
    await applyUpdateAndMaybeRecalculate(ctx, { goal });
  });

  bot.action(/activity_(low|medium|high)/, async (ctx) => {
    const map = { low: 'низкий', medium: 'средний', high: 'высокий' };
    await ctx.answerCbQuery();
    await applyUpdateAndMaybeRecalculate(ctx, { activity_level: map[ctx.match[1]] });
  });

  bot.on('text', async (ctx, next) => {
    if (!ctx.session || !ctx.session.waitingForUpdate || !ctx.session.updateField) return next();
    const field = ctx.session.updateField;
    const value = ctx.message.text.trim();
    let updateData = {};
    switch (field) {
      case 'age': {
        const age = parseInt(value);
        if (isNaN(age) || age <= 0 || age > 120) return ctx.reply('❌ Введите корректный возраст (1-120 лет).');
        updateData.age = age; break;
      }
      case 'gender': {
        const genderInput = value.toLowerCase();
        if (!['м','ж','m','f','муж','жен','мужской','женский'].some(g => genderInput.includes(g))) {
          return ctx.reply('❌ Укажите "М" (мужской) или "Ж" (женский).');
        }
        updateData.gender = (genderInput.includes('м')) || (genderInput.startsWith('m')) || (genderInput.includes('муж')) ? 'M' : 'F';
        break;
      }
      case 'weight': {
        const weight = parseFloat(value.replace(',', '.'));
        if (isNaN(weight) || weight <= 0 || weight > 500) return ctx.reply('❌ Введите корректный вес (0.1-500 кг).');
        updateData.weight = weight; break;
      }
      case 'height': {
        const height = parseInt(value);
        if (isNaN(height) || height <= 0 || height > 250) return ctx.reply('❌ Введите корректный рост (1-250 см).');
        updateData.height = height; break;
      }
      case 'activity': {
        const activity = value.toLowerCase();
        if (!['низкий','средний','высокий'].includes(activity)) {
          return ctx.reply('❌ Укажите: низкий, средний или высокий.');
        }
        updateData.activity_level = activity; break;
      }
      case 'goal': {
        const goalInput = value.toLowerCase();
        updateData.goal = goalInput.includes('сброс') ? 'lose' : goalInput.includes('набор') ? 'gain' : 'maintain';
        break;
      }
    }
    await applyUpdateAndMaybeRecalculate(ctx, updateData);
  });
}

async function applyUpdateAndMaybeRecalculate(ctx, updateData) {
  try {
    const telegramId = ctx.from.id;
    const user = await userController.getUserByTelegramId(telegramId);
    if (!user) return ctx.reply('⚠️ Пользователь не найден.', getMainMenuKeyboard());

    // Проверяем, что действительно изменилось
    const actualChanges = [];
    if (updateData.age && parseInt(updateData.age) !== parseInt(user.age)) actualChanges.push('возраст');
    if (updateData.gender && updateData.gender !== user.gender) actualChanges.push('пол');
    if (updateData.weight && parseFloat(updateData.weight) !== parseFloat(user.weight)) actualChanges.push('вес');
    if (updateData.height && parseInt(updateData.height) !== parseInt(user.height)) actualChanges.push('рост');
    if (updateData.activity_level && updateData.activity_level !== user.activity_level) actualChanges.push('уровень активности');
    if (updateData.goal && updateData.goal !== user.goal) actualChanges.push('цель');

    // Если ничего не изменилось - сообщаем об этом
    if (actualChanges.length === 0) {
      if (ctx.session) {
        ctx.session.updateField = null;
        ctx.session.waitingForUpdate = false;
      }
      return ctx.reply(
        `ℹ️ Вы выбрали то же самое значение. Никаких изменений не внесено.`,
        getMainMenuKeyboard()
      );
    }

    const merged = {
      weight: updateData.weight ?? user.weight,
      height: updateData.height ?? user.height,
      age: updateData.age ?? user.age,
      gender: updateData.gender ?? user.gender,
      activity_level: updateData.activity_level ?? user.activity_level,
      goal: updateData.goal ?? user.goal
    };

    if (!merged.weight || !merged.height || !merged.age || !merged.gender) {
      throw new Error('Missing required data for calculation');
    }

    const bmr = calculateBMR({ weight: merged.weight, height: merged.height, age: merged.age, gender: merged.gender });
    const tdee = bmr * activityFactor(merged.activity_level);
    const dailyCalories = adjustCaloriesForGoal(tdee, merged.goal);
    const macros = calculateMacros({
      calories: dailyCalories,
      weight: merged.weight,
      goal: merged.goal
    });

    await userController.upsertUser({
      telegram_id: telegramId,
      age: merged.age,
      gender: merged.gender,
      weight: merged.weight,
      height: merged.height,
      activity: merged.activity_level,
      goal: merged.goal,
      daily_calories: dailyCalories,
      protein: macros.protein,
      fat: macros.fat,
      carbs: macros.carbs
    });

    if (ctx.session) {
      ctx.session.updateField = null;
      ctx.session.waitingForUpdate = false;
    }

    const updatedUser = await userController.getUserByTelegramId(telegramId);
    const genderText = updatedUser?.gender ? (updatedUser.gender === 'M' ? 'Мужской' : 'Женский') : '—';
    const activityText = { 'низкий': 'Низкий', 'средний': 'Средний', 'высокий': 'Высокий' }[updatedUser?.activity_level] || updatedUser?.activity_level || '—';
    const goalText = { 'lose': 'Сброс веса', 'maintain': 'Поддержание', 'gain': 'Набор веса' }[updatedUser?.goal] || updatedUser?.goal || '—';
    
    await ctx.reply(
      `✅ ${actualChanges.join(', ')} успешно обновлен${actualChanges.length > 1 ? 'ы' : ''}!\n\n` +
      `📋 Обновленные данные:\n` +
      `👤 Возраст: ${updatedUser?.age ?? '—'} лет\n` +
      `👥 Пол: ${genderText}\n` +
      `⚖️ Вес: ${updatedUser?.weight ?? '—'} кг\n` +
      `📏 Рост: ${updatedUser?.height ?? '—'} см\n` +
      `🤸 Активность: ${activityText}\n` +
      `🥅 Цель: ${goalText}\n\n` +
      `📊 Новая норма калорий: ${updatedUser?.daily_calories ?? '—'} ккал\n` +
      `🥩 Белки: ${updatedUser?.protein ?? '—'} г | 🥑 Жиры: ${updatedUser?.fat ?? '—'} г | 🍞 Углеводы: ${updatedUser?.carbs ?? '—'} г`,
      { parse_mode: 'HTML' }
    );
    await ctx.reply(
      '🔄 Хотите сгенерировать новое меню с учетом обновленных параметров?',
      { reply_markup: { inline_keyboard: [[ { text: '✅ Да, сгенерировать новое меню', callback_data: 'generate_new_menu' }, { text: '❌ Нет, позже', callback_data: 'no_new_menu' } ]] } }
    );
  } catch (error) {
    console.error('Error updating user data:', error);
    let errorMessage = '❌ Произошла ошибка при обновлении данных. Попробуйте еще раз.';
    if (error.message === 'Missing required data for calculation') errorMessage = '❌ Недостаточно данных для пересчета калорий. Попробуйте обновить все данные целиком.';
    else if (error.message === 'Invalid calculated values') errorMessage = '❌ Ошибка в расчете калорий. Попробуйте обновить все данные целиком.';
    await ctx.reply(errorMessage, getMainMenuKeyboard());
  }
}

module.exports = { registerUpdateHandlers };

