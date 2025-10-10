import { Markup } from 'telegraf'

// ----- SEND ----- //

/**
 * Send product card directly to user (no ctx)
 * @param {object} params
 * @param {Bot} params.bot
 * @param {number} params.chatId
 * @param {{ photo: string, options: ProductCardMessageOptions }} params.card
 * @returns {Promise<TgMsg>}
 */
export async function sendProductCardPush({bot, chatId, card}) {
  return bot.telegram.sendPhoto(chatId, card.photo, card.options)
}

// ----- REPLY ----- //

/**
 * Reply to user with product card via ctx
 * @param {object} params
 * @param {Context} params.ctx
 * @param {{ photo: string, options: ProductCardMessageOptions }} params.card
 * @returns {Promise<TgMsg>}
 */
export async function replyWithProductCard({ctx, card}) {
  return ctx.replyWithPhoto(card.photo, card.options)
}

/**
 * Send welcome message for new user
 * @param {object} params
 * @param {Context} params.ctx
 * @param {string} params.firstName
 * @returns {Promise<TgMsg>}
 */
export async function replyWelcome({ctx, firstName}) {
  return await ctx.reply(
    `Привет, ${firstName || 'друг'}! 👋\n\n` +
    'Я бот для отслеживания цен на товары Wildberries.\n' +
    'Что я умею:\n' +
    '— Показывать карточку товара по артикулу\n' +
    '— Подписывать тебя на изменения цены\n' +
    '— Уведомлять, когда цена изменилась 📉📈'
  )
}

/**
 * Send message for returning user
 * @param {object} params
 * @param {Context} params.ctx
 * @param {string} params.firstName
 * @returns {Promise<TgMsg>}
 */
export async function replyWelcomeBack({ctx, firstName}) {
  return await ctx.reply(`С возвращением, ${firstName || 'друг'}! 👋`)
}

/**
 * @param {object} params
 * @param {Context} params.ctx
 * @param {boolean} params.hasSubscriptions
 * @returns {Promise<TgMsg>}
 */
export async function replyMainMenu({ctx, hasSubscriptions}) {
  const buttons = [
    [{ text: '📋 Мои подписки', callback_data: 'subscriptions' }],
    [{ text: '➕ Добавить товар', callback_data: 'addProduct' }]
  ]

  if (hasSubscriptions) {
    buttons.push([{ text: '❌ Отписаться от всех', callback_data: 'unsubAll' }])
  }

  return await ctx.reply('Главное меню:', Markup.inlineKeyboard(buttons))
}

/**
 * @param {object} params
 * @param {Context} params.ctx
 * @returns {Promise<TgMsg>}
 */
export async function replyAddProductHint({ctx}) {
  return await ctx.reply('Пришли артикул или ссылку на товар на WB, и я покажу карточку 📦')
}

/**
 * @param {object} params
 * @param {Context} params.ctx
 * @returns {Promise<TgMsg>}
 */
export async function replyUnsubAllConfirm({ctx}) {
  return await ctx.reply(
    '⚠️ Ты уверен? Это удалит все твои подписки!',
    Markup.inlineKeyboard([
      [{ text: '✅ Да, удалить все', callback_data: 'unsubAllConfirm' }],
      [{ text: '❌ Отмена', callback_data: 'cancel' }]
    ])
  )
}

/**
 * Sends confirmation dialog before unsubscribing
 * @param {object} params
 * @param {Context} params.ctx
 * @param {number} params.productId
 * @param {number} params.optionId
 * @returns {Promise<TgMsg>}
 */
export async function replyUnsubConfirm({ctx, productId, optionId}) {
  return await ctx.reply(
    '⚠️ Ты уверен, что хочешь отписаться от этого товара?',
    Markup.inlineKeyboard([
      [{ text: '✅ Да, отписаться', callback_data: `unsubConfirm:${productId}:${optionId}` }],
      [{ text: '❌ Отмена', callback_data: 'cancel' }]
    ])
  )
}

/**
 * @param {object} params
 * @param {Context} params.ctx
 * @returns {Promise<TgMsg>}
 */
export async function replyProductNotFound({ctx}) {
  return await ctx.reply('⚠️ Товар не найден или больше не доступен')
}

/**
 * Sends confirmation message after successful subscription
 * @param {object} params
 * @param {Context} params.ctx
 * @param {ProductCard} params.product
 * @returns {Promise<TgMsg>}
 */
export async function replySubscribed({ctx, product}) {
  return await ctx.reply(`Начинаю следить за товаром ${product.id} 👀`)
}

/**
 * @param {object} params
 * @param {Context} params.ctx
 * @param {UserService} params.userService
 * @param {WbApi} params.api
 * @returns {Promise<TgMsg>}
 */
export async function replySubscriptionsInfo({ctx, userService, api}) {
  const userId = ctx.from.id
  const subs = await userService.getSubscriptions(userId)

  if (!subs.length) {
    return await ctx.reply('📭 У тебя пока нет подписок')
  }

  const productIds = subs.map(s => s.productId)
  const products = await api.getProducts(productIds)

  const buttons = products.map(p => [
    { text: `${p.id} — ${p.name.slice(0, 30)}`, callback_data: `product:${p.id}` }
  ])

  return await ctx.reply('📋 Твои подписки:', Markup.inlineKeyboard(buttons))
}

/**
 * Sends size selector when product has multiple sizes
 * @param {object} params
 * @param {Context} params.ctx
 * @param {ProductCard} params.product
 * @returns {Promise<TgMsg>}
 */
export async function replySizeSelector({ctx, product}) {
  const sizeButtons = product.sizes.map(s => {
    const label = `${s.name} — ${s.currentPrice.toLocaleString()} ₽`

    return [{ text: label, callback_data: `subsize:${product.id}:${s.optionId}` }]
  })

  return await ctx.reply(
    'У этого товара несколько размеров. Выбери нужный, чтобы подписаться 👇',
    Markup.inlineKeyboard(sizeButtons)
  )
}


/**
 * @param {object} params
 * @param {Context} params.ctx
 * @returns {Promise<TgMsg>}
 */
export async function replyUnknownText({ ctx }) {
  return await ctx.reply('😕 К сожалению, я тебя не понял. Вот меню')
}

/**
 * Sends message when subscribed size no longer exists
 * @param {object} params
 * @param {Context} params.ctx
 * @returns {Promise<TgMsg>}
 */
export async function replyProductOutdated({ ctx }) {
  return await ctx.reply('⚠️ Похоже, выбранный размер больше недоступен')
}

/**
 * Sends short "subscription removed" message
 * @param {object} params
 * @param {Context} params.ctx
 * @param {number} params.productId
 * @returns {Promise<TgMsg>}
 */
export async function replyUnsubscribed({ ctx, productId }) {
  return await ctx.reply(`✅ Подписка на ${productId} удалена`)
}

/**
 * Sends message after removing all subscriptions
 * @param {object} params
 * @param {Context} params.ctx
 * @returns {Promise<TgMsg>}
 */
export async function replyUnsubAllDone({ ctx }) {
  return await ctx.reply('✅ Все твои подписки удалены')
}

/**
 * Sends error message
 * @param {object} params
 * @param {Context} params.ctx
 * @returns {Promise<TgMsg>}
 */
export async function replyError({ ctx }) {
  return await ctx.reply('⚠️ Что-то пошло не так, попробуй позже')
}

// ----- BUILD ----- //

/**
 * Build caption prefix for price change notification
 * @param {number} prevPrice
 * @param {number} currentPrice
 * @returns {string}
 */
export function buildPriceChangePrefix(prevPrice, currentPrice) {
  const diff = currentPrice - prevPrice
  const percent = prevPrice ? (diff / prevPrice) * 100 : 0

  const isDecrease = diff < 0
  const arrow = isDecrease ? '🟢' : '🔴'
  const verb = isDecrease ? 'снизилась' : 'увеличилась'
  const sign = isDecrease ? '-' : '+'

  return `*${arrow} Цена ${verb} на ${Math.abs(diff).toLocaleString()} ₽ (${sign}${Math.abs(percent).toFixed(1)}%)*\n\n`
}

/**
 * Build product card message data
 * @param {ProductCard} product
 * @param {object} [opts]
 * @param {boolean} [opts.isSubscribed]
 * @param {number|null} [opts.displayPrice]
 * @param {string|null} [opts.displaySize]
 * @param {string} [opts.captionPrefix]
 * @returns {{ productId: number, photo: string, options: ProductCardMessageOptions }}
 */
export function buildProductCard(product, {
  isSubscribed = false,
  displaySize = null,
  displayPrice = null,
  captionPrefix = ''
} = {}) {
  const e = escapeMarkdown

  const price = displayPrice ? `${displayPrice.toLocaleString()} ₽` : '—'
  const sizeLine = displaySize ? `\n📏 Размер: ${e(displaySize)}` : ''
  const ratingLine = product.rating ? `⭐️ ${e(String(product.rating))} (${e(String(product.feedbacks))} отзывов)` : ''

  const caption =
    captionPrefix +
    `📦 *${e(product.name)}*\n\n` +
    `💰 Цена: *${e(price)}*${sizeLine}\n` +
    (ratingLine ? ratingLine + '\n' : '') +
    `🔢 Артикул: ${product.id}\n` +
    (product.brand ? `🏷 Бренд: ${e(product.brand)}\n` : '') +
    (product.supplier ? `👤 Продавец: ${e(product.supplier)}\n` : '') +
    `\n🔗 [Открыть на WB](${product.link})`

  const buttons = [
    [
      isSubscribed
        ? { text: '❌ Отписаться', callback_data: `unsub:${product.id}:${product.sizes.find(s => s.optionId)?.optionId || 0}` }
        : { text: '✅ Подписаться', callback_data: `subscribe:${product.id}` }
    ],
    [{ text: '🏠 Главное меню', callback_data: 'menu' }]
  ]

  return {
    productId: product.id,
    photo: product.imageURL,
    options: {
      caption,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    }
  }
}

// ----- UTILS ----- //

/**
 * Escape text for Markdown (basic)
 * @param {string} text
 * @returns {string}
 */
function escapeMarkdown(text = '') {
  return text.replace(/[*_]/g, '')
}
