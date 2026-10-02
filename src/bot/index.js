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
      ctx.reply('👋 Привет! Я помогу рассчитать твою норму калорий и составить персональное меню на неделю.\n\n📝 Давайте начнем с регистрации!');
      ctx.scene.enter('registerScene');
    }
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

