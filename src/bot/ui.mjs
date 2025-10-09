import { Markup } from 'telegraf'

/**
 * Send welcome message for new user
 * @param {Context} ctx
 * @param {string} firstName
 * @returns {Promise<TgMsg>}
 */
export async function sendWelcome(ctx, firstName) {
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
 * @param {Context} ctx
 * @param {string} firstName
 * @returns {Promise<TgMsg>}
 */
export async function sendWelcomeBack(ctx, firstName) {
  return await ctx.reply(`С возвращением, ${firstName || 'друг'}! 👋`)
}

/**
 * @param {Context} ctx
 * @param {boolean} hasSubscriptions
 * @returns {Promise<TgMsg>}
 */
export async function sendMainMenu(ctx, hasSubscriptions) {
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
 * @param {Context} ctx
 * @returns {Promise<TgMsg>}
 */
export async function sendAddProductHint(ctx) {
  return await ctx.reply('Пришли артикул или ссылку на товар на WB, и я покажу карточку 📦')
}

/**
 * @param {Context} ctx
 * @returns {Promise<TgMsg>}
 */
export async function sendUnsubAllConfirm(ctx) {
  return await ctx.reply(
    '⚠️ Ты уверен? Это удалит все твои подписки!',
    Markup.inlineKeyboard([
      [{ text: '✅ Да, удалить все', callback_data: 'unsubAllConfirm' }], // TODO
      [{ text: '❌ Отмена', callback_data: 'cancel' }]
    ])
  )
}

/**
 * Sends confirmation dialog before unsubscribing
 * @param {Context} ctx
 * @param {number} productId
 * @param {number} optionId
 * @returns {Promise<TgMsg>}
 */
export async function sendUnsubConfirm(ctx, productId, optionId) {
  return await ctx.reply(
    '⚠️ Ты уверен, что хочешь отписаться от этого товара?',
    Markup.inlineKeyboard([
      [{ text: '✅ Да, отписаться', callback_data: `unsubConfirm:${productId}:${optionId}` }],
      [{ text: '❌ Отмена', callback_data: 'cancel' }]
    ])
  )
}

/**
 * @param {Context} ctx
 * @returns {Promise<TgMsg>}
 */
export async function sendProductNotFound(ctx) {
  return await ctx.reply('⚠️ Товар не найден или больше не доступен')
}

/**
 * Sends confirmation message after successful subscription
 * @param {Context} ctx
 * @param {ProductCard} product
 * @returns {Promise<TgMsg>}
 */
export async function sendSubscribed(ctx, product) {
  return await ctx.reply(`Начинаю следить за товаром ${product.id} 👀`)
}

/**
 * @param {Context} ctx
 * @param {UserService} userService
 * @param {WbApi} api
 * @returns {Promise<TgMsg>}
 */
export async function sendSubscriptionsInfo(ctx, userService, api) {
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
 * Sends product card with info and action buttons
 * @param {Context} ctx
 * @param {{
 *   product: ProductCard,
 *   isSubscribed?: boolean,
 *   displaySize?: string|null,
 *   displayPrice?: number|null
 * }} params
 * @returns {Promise<TgMsg>}
 */
export async function sendProductCard(ctx, { product, isSubscribed = false, displaySize = null, displayPrice = null }) {
  const price = displayPrice ? `${displayPrice.toLocaleString()} ₽` : '—'

  const sizeLine = displaySize ? `\n📏 Размер: ${displaySize}` : ''
  const ratingLine = product.rating ? `⭐️ ${product.rating} (${product.feedbacks} отзывов)` : ''

  const caption =
    `📦 ${product.name}\n\n` +
    `💰 Цена: ${price}${sizeLine}\n` +
    (ratingLine ? ratingLine + '\n' : '') +
    `🔢 Артикул: ${product.id}\n` +
    (product.brand ? `🏷 Бренд: ${product.brand}\n` : '') +
    (product.supplier ? `👤 Продавец: ${product.supplier}\n` : '') +
    `\n🔗 [Открыть на WB](${product.link})`

  const buttons = [
    [
      isSubscribed
        ? { text: '❌ Отписаться', callback_data: `unsub:${product.id}:${product.sizes.find(s => s.optionId)?.optionId || 0}` }
        : { text: '✅ Подписаться', callback_data: `subscribe:${product.id}` }
    ],
    [{ text: '🏠 Главное меню', callback_data: 'menu' }]
  ]

  return await ctx.replyWithPhoto(product.imageURL, {
    caption,
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(buttons)
  })
}

/**
 * Sends size selector when product has multiple sizes
 * @param {Context} ctx
 * @param {ProductCard} product
 * @returns {Promise<TgMsg>}
 */
export async function sendSizeSelector(ctx, product) {
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
 * @param {Context} ctx
 * @returns {Promise<TgMsg>}
 */
export async function sendUnknownText(ctx) {
  return await ctx.reply('😕 К сожалению, я тебя не понял. Вот меню')
}

/**
 * Sends message when subscribed size no longer exists
 * @param {Context} ctx
 * @returns {Promise<TgMsg>}
 */
export async function sendProductOutdated(ctx) {
  return await ctx.reply('⚠️ Похоже, выбранный размер больше недоступен')
}

/**
 * Sends short "subscription removed" message
 * @param {Context} ctx
 * @param {number} productId
 * @returns {Promise<TgMsg>}
 */
export async function sendUnsubscribed(ctx, productId) {
  return await ctx.reply(`✅ Подписка на ${productId} удалена`)
}

/**
 * Sends message after removing all subscriptions
 * @param {Context} ctx
 * @returns {Promise<TgMsg>}
 */
export async function sendUnsubAllDone(ctx) {
  return await ctx.reply('✅ Все твои подписки удалены')
}

/**
 * Sends error message
 * @param {Context} ctx
 * @returns {Promise<TgMsg>}
 */
export async function sendError(ctx) {
  return await ctx.reply('⚠️ Что-то пошло не так, попробуй позже')
}

