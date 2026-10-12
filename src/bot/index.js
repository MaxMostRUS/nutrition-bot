const { Telegraf, session, Scenes } = require('telegraf');
const rateLimit = require('telegraf-ratelimit');
const { BOT_TOKEN } = require('../config');
const registerScene = require('../scenes/registerScene');
const { getMainMenuKeyboard } = require('../keyboards');
const validateUser = require('./middlewares/validateUser');
const { registerMenuCommands } = require('./handlers/menu.handlers');
const { registerUserCommands } = require('./handlers/user.handlers');
const { registerUpdateHandlers } = require('./handlers/update.handlers');
const { registerPaymentHandlers } = require('./handlers/payment.handlers');

function createBot() {
  if (!BOT_TOKEN) {
    throw new Error('BOT_TOKEN is not set. Please configure environment variables.');
  }
  const bot = new Telegraf(BOT_TOKEN);

  bot.use(rateLimit({
    window: 1000,
    limit: 1,
    onLimitExceeded: (ctx) => ctx.reply('Пожалуйста, подождите немного перед следующим запросом.')
  }));

  bot.use(async (ctx, next) => {
    try {
      await next();
    } catch (err) {
      console.error('Bot error:', err);
      await ctx.reply('Произошла ошибка. Пожалуйста, попробуйте позже или обратитесь к администратору.');
    }
  });

  const stage = new Scenes.Stage([ registerScene ]);
  bot.use(session());
  bot.use(stage.middleware());

  // /start
  bot.start(validateUser, async (ctx) => {
    const telegramId = ctx.from.id;
    const userController = require('../controllers/userController');
    const user = await userController.getUserByTelegramId(telegramId);
    if (user) {
      ctx.reply('👋 С возвращением! Используйте кнопки ниже для навигации.', getMainMenuKeyboard());
    } else {
      if (!ctx.session) ctx.session = {};
      ctx.session.awaitingCoachMacros = true;
      await ctx.reply(
        '👋 Привет! Я помогу составить персональное меню на неделю.\n\n' +
        'У вас уже рассчитаны тренером суточные Б/Ж/У?\n' +
        'Если да, я использую их без пересчёта. Если нет, рассчитаю норму по вашим данным.',
        { reply_markup: { keyboard: [['Да, внесу Б/Ж/У', 'Нет, рассчитать']], resize_keyboard: true, one_time_keyboard: true } }
      );
    }
  });

  // Collect coach-provided macros before entering the regular profile wizard.
  bot.on('text', async (ctx, next) => {
    if (!ctx.session?.awaitingCoachMacros) return next();
    const text = String(ctx.message.text || '').trim();
    if (/^нет/i.test(text) || /рассчитать/i.test(text)) {
      delete ctx.session.awaitingCoachMacros;
      await ctx.reply('📝 Тогда рассчитаем норму. Давайте начнём регистрацию.');
      return ctx.scene.enter('registerScene');
    }
    if (ctx.session.awaitingCoachMacros === true && (/^да/i.test(text) || /внесу/i.test(text))) {
      ctx.session.awaitingCoachMacros = 'values';
      return ctx.reply('Введите Б/Ж/У одной строкой, например: 180 - 70 - 220');
    }
    if (ctx.session.awaitingCoachMacros === 'values') {
      const values = text
        .replace(/,/g, '.')
        .split(/\s*[-–—/]\s*|\s+/)
        .map(Number)
        .filter(Number.isFinite);
      if (values.length !== 3 || values.some((value) => value <= 0)) {
        return ctx.reply('Не удалось распознать Б/Ж/У. Пример формата: 180 - 70 - 220');
      }
      ctx.session.coachMacros = {
        protein: Math.round(values[0]),
        fat: Math.round(values[1]),
        carbs: Math.round(values[2])
      };
      delete ctx.session.awaitingCoachMacros;
      await ctx.reply('✅ Б/Ж/У сохранены. Теперь заполним профиль, чтобы подобрать рецепты и порции.');
      return ctx.scene.enter('registerScene');
    }
    return ctx.reply('Выберите «Да, внесу Б/Ж/У» или «Нет, рассчитать».');
  });

  // Feature handlers
  bot.use(validateUser);
  registerMenuCommands(bot);
  registerUserCommands(bot);
  registerUpdateHandlers(bot);
  registerPaymentHandlers(bot);

  // Update flows and callbacks kept in original scene/handlers
  return bot;
}

module.exports = createBot;
