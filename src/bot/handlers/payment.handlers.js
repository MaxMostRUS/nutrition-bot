const userController = require('../../controllers/userController');
const {
  PREMIUM_PLAN_STARS,
  startTrial,
  buildPremiumInvoice,
  recordSuccessfulPayment,
  hasPremiumAccess
} = require('../../services/paymentService');
const { TRIBUTE_PRODUCT_URL } = require('../../config');

function registerPaymentHandlers(bot) {
  bot.command('trial', async (ctx) => {
    const user = await userController.getUserByTelegramId(ctx.from.id);
    if (!user) return ctx.reply('Сначала выполните команду /start.');
    const result = await startTrial(user.id);
    const until = new Date(result.premium_until).toLocaleDateString('ru-RU');
    await ctx.reply(`🎁 Тестовый доступ активирован до ${until}.`);
  });

  bot.command('premium', async (ctx) => {
    const user = await userController.getUserByTelegramId(ctx.from.id);
    if (!user) return ctx.reply('Сначала выполните команду /start.');
    if (hasPremiumAccess(user)) {
      return ctx.reply(`⭐ Premium уже активен до ${new Date(user.premium_until).toLocaleDateString('ru-RU')}.`);
    }

    const invoice = buildPremiumInvoice();
    const cardButton = TRIBUTE_PRODUCT_URL
      ? { inline_keyboard: [[{ text: '💳 Оплатить картой', url: TRIBUTE_PRODUCT_URL }]] }
      : undefined;
    await ctx.replyWithInvoice(invoice, cardButton ? { reply_markup: cardButton } : undefined);
  });

  bot.on('pre_checkout_query', async (ctx) => {
    try {
      const query = ctx.update.pre_checkout_query;
      if (!query.invoice_payload.startsWith('premium_30_days:')) {
        return ctx.answerPreCheckoutQuery(false, 'Неизвестный тариф.');
      }
      await ctx.answerPreCheckoutQuery(true);
    } catch (error) {
      console.error('Pre-checkout failed:', error);
      await ctx.answerPreCheckoutQuery(false, 'Не удалось проверить заказ. Попробуйте ещё раз.');
    }
  });

  bot.on('successful_payment', async (ctx) => {
    const user = await userController.getUserByTelegramId(ctx.from.id);
    if (!user) return ctx.reply('Платёж получен, но пользователь не найден. Обратитесь в поддержку.');
    try {
      const result = await recordSuccessfulPayment({
        userId: user.id,
        payment: ctx.message.successful_payment
      });
      if (result.duplicate) return ctx.reply('Платёж уже был обработан. Premium активен.');
      await ctx.reply(`✅ Оплата получена. Premium активен до ${new Date(result.premiumUntil).toLocaleDateString('ru-RU')}.`);
    } catch (error) {
      console.error('Successful payment processing failed:', error);
      await ctx.reply('Платёж получен, но активация задерживается. Мы проверим транзакцию вручную.');
    }
  });
}

module.exports = { registerPaymentHandlers };
