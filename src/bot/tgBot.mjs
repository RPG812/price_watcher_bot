import { Markup, Telegraf } from 'telegraf'
import { tg_token } from '../../auth/auth.mjs'

/**
 * @typedef {Object} UserMessages
 * @property {number[]} menus - list of menu message IDs
 * @property {number[]} subs - list of subscription menu message IDs
 * @property {Map<number, number>} products - map of articleId -> messageId
 */

export class TgBot {
  /**
   * @param {import('./wbApi.mjs').WbApi} api
   */
  constructor(api) {
    this.api = api
    this.bot = new Telegraf(tg_token)

    this.pageSize = 5

    /** @type {Map<number, UserMessages>} */
    this.userMessages = new Map()
  }

  /**
   * Start bot (polling)
   * @returns {Promise<void>}
   */
  async start() {
    this.initHandlers()
    await this.bot.launch()
    console.log('[TgBot] started')
  }

  /**
   * Stop bot gracefully
   * @param {string} [reason]
   * @returns {Promise<void>}
   */
  async stop(reason = 'manual') {
    console.log(`[TgBot] stopping (${reason})...`)
    await this.bot.stop(reason)
  }

  /**
   * Register handlers
   */
  initHandlers() {
    // Commands
    this.bot.start(context => this.handleStart(context))
    this.bot.command('menu', context => this.showMainMenu(context))
    this.bot.command('subs', context => this.handleSubscriptions(context))

    // Inline menu actions
    this.bot.action('openSubs', context => this.handleSubscriptions(context))
    this.bot.action('addProductHelp', async context => {
      await context.reply('Пришли артикул WB, и я покажу карточку 📦')
    })
    this.bot.action('unsubAllConfirm', context => this.handleUnsubAllConfirm(context))

    // Actions: subscriptions navigation
    this.bot.action(/subsPage:(\d+)/, context => this.handleSubscriptionsPage(context))

    // Actions: single subscribe/unsubscribe
    this.bot.action(/confirmUnsub:(\d+)/, context => this.handleUnsubExecute(context))
    this.bot.action(/unsub:(\d+)/, context => this.handleUnsubConfirm(context))
    this.bot.action(/sub:(\d+)/, context => this.handleSubscribe(context))

    // Actions: unsubscribe all
    this.bot.action('menu', context => this.showMainMenu(context))
    this.bot.action('unsubAllConfirm', context => this.handleUnsubAllConfirm(context))
    this.bot.action('unsubAllExecute', context => this.handleUnsubAllExecute(context))
    this.bot.action('cancelUnsubAll', async context => {
      await context.reply('Хорошо 👍 Подписки остались без изменений')
    })

    // Plain text handler (article IDs etc.)
    this.bot.on('text', context => this.handleText(context))

    // Global error handler
    this.bot.catch(async (err, context) => {
      console.error('[TgBot] Error for user', context.from?.id, err)
      try {
        await context.reply('⚠️ Ошибка, попробуй чуть позже')
      } catch (e) {
        console.error('[TgBot] Failed to reply on error:', e.message)
      }
    })
  }

  /**
   * Show main menu
   */
  async showMainMenu(context) {
    const userId = context.from.id
    const chatId = context.chat.id

    await this.deleteUserMessages(userId, chatId, 'menus')

    const msg = await context.reply(
      'Главное меню:',
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📋 Мои подписки', callback_data: 'openSubs' }],
            [{ text: '➕ Добавить товар', callback_data: 'addProductHelp' }],
            [{ text: '❌ Отписаться от всех', callback_data: 'unsubAllConfirm' }]
          ]
        }
      }
    )

    this.trackUserMessage(userId, 'menus', msg.message_id)
  }

  /**
   * @param {import('telegraf').Context} context
   */
  async handleStart(context) {
    const userId = context.from.id
    const username = context.from.username || ''
    const firstName = context.from.first_name || ''
    const lastName = context.from.last_name || ''

    const users = this.api.db.collection('users')
    const existing = await users.findOne({ _id: userId })

    if (!existing) {
      await context.reply(`Привет, ${firstName || 'друг'}! 👋`)
      await context.reply(
        'Я бот для отслеживания цен на товары Wildberries.\n' +
        'Что я умею:\n' +
        '— Показывать карточку товара по артикулу\n' +
        '— Подписывать тебя на изменения цены\n' +
        '— Уведомлять, когда цена изменилась 📉📈'
      )

      await users.insertOne({
        _id: userId,
        username,
        firstName,
        lastName,
        subscriptions: [],
        createdAt: new Date(),
        lastActiveAt: new Date()
      })

      console.log(`[TgBot] new user ${userId} (${username}) created`)
    } else {
      await context.reply(`С возвращением, ${firstName || 'друг'}! 👋`)
      await users.updateOne(
        { _id: userId },
        { $set: { lastActiveAt: new Date() } }
      )
    }

    await this.showMainMenu(context)
  }

  /**
   * @param {import('telegraf').Context} context
   */
  async handleText(context) {
    const text = context.message.text.trim()
    const chatId = context.chat.id
    const messageId = context.message.message_id

    // try to delete user message
    try {
      await this.bot.telegram.deleteMessage(chatId, messageId)
    } catch (err) {
      console.error('[TgBot] Failed to delete user text message:', err.message)
    }

    if (/^\d+$/.test(text)) {
      await this.handleArticleInput(context, Number(text))
    } else {
      await context.reply('К сожалению, я тебя не понял. Вот тебе меню')
      await this.showMainMenu(context)
    }
  }

  /**
   * @param {import('telegraf').Context} context
   * @param {number} productId
   */
  async handleArticleInput(context, productId) {
    const userId = context.from.id
    const chatId = context.chat.id
    const users = this.api.db.collection('users')

    await users.updateOne(
      { _id: userId },
      { $set: { lastActiveAt: new Date() } }
    )

    const products = await this.api.getProducts([productId])

    if (products.length === 0) {
      await context.reply('Товар не найден')
      return
    }

    const product = products[0]
    const cardMessage = this.formatProductCard(product)

    const user = await users.findOne({ _id: userId })
    const isSubscribed = user?.subscriptions?.includes(productId)

    await this.deleteProductMessage(userId, chatId, productId)

    const keyboard = isSubscribed
      ? {
        reply_markup: {
          inline_keyboard: [
            [{ text: '❌ Отписаться', callback_data: `unsub:${product.id}` }]
          ]
        }
      }
      : {
        reply_markup: {
          inline_keyboard: [
            [{ text: '✅ Подписаться', callback_data: `sub:${product.id}` }]
          ]
        }
      }

    const msg = await context.replyWithPhoto(cardMessage.photo, {
      caption: isSubscribed
        ? `${cardMessage.caption}\n\n✅ Ты уже подписан на этот товар`
        : cardMessage.caption,
      parse_mode: cardMessage.parse_mode,
      ...keyboard
    })

    this.trackProductMessage(userId, productId, msg.message_id)
    await this.api.saveProduct(product)
  }

  /**
   * @param {import('telegraf').Context} context
   */
  async handleSubscribe(context) {
    const userId = context.from.id
    const productId = Number(context.match[1])
    const users = this.api.db.collection('users')

    await users.updateOne(
      { _id: userId },
      { $addToSet: { subscriptions: productId } }
    )

    await context.reply(`Теперь я слежу за ценой товара ${productId} 👀`)
    console.log(`[TgBot] user ${userId} subscribed to ${productId}`)
  }

  /**
   * @param {import('./wbApi.mjs').ProductCard} product
   * @returns {{ photo: string, caption: string, parse_mode: string }}
   */
  formatProductCard(product) {
    const ratingLine = product.rating
      ? `⭐️ ${product.rating} (${product.feedbacks} отзывов)`
      : ''

    const stockLine = product.stock > 0
      ? `📦 В наличии: ${product.stock} шт.`
      : '❌ Нет в наличии'

    const caption =
      `📦 ${product.name}\n\n` +
      `💰 Цена: ${product.priceCurrent} ₽` + '\n\n' +
      `🔢 Артикул: ${product.id}\n` +
      (product.brand ? `🏷 Бренд: ${product.brand}\n` : '') +
      (product.supplier ? `👤 Продавец: ${product.supplier}\n` : '') +
      (ratingLine ? ratingLine + '\n' : '') +
      (stockLine ? stockLine + '\n' : '') +
      `\n 🔗 [Открыть на WB](${product.link})`

    return {
      photo: product.imageURL,
      caption,
      parse_mode: 'Markdown'
    }
  }

  /**
   * @param {import('telegraf').Context} context
   */
  async handleUnsubConfirm(context) {
    const productId = context.match[1]
    await context.reply(
      `Ты уверен, что хочешь отписаться от товара ${productId}?`,
      Markup.inlineKeyboard([
        [Markup.button.callback('✅ Да', `confirmUnsub:${productId}`)],
        [Markup.button.callback('❌ Нет', 'cancelUnsub')]
      ])
    )
  }

  /**
   * Execute unsubscribe
   */
  async handleUnsubExecute(context) {
    const userId = context.from.id
    const productId = Number(context.match[1])
    const users = this.api.db.collection('users')

    await users.updateOne(
      { _id: userId },
      { $pull: { subscriptions: productId } }
    )

    await context.reply(`Ты отписался от товара ${productId} ❌`)
  }

  /**
   * @param {import('telegraf').Context} context
   */
  async handleSubscriptions(context) {
    const userId = context.from.id
    const chatId = context.chat.id
    const users = this.api.db.collection('users')
    const user = await users.findOne({ _id: userId })

    if (!user || user.subscriptions.length === 0) {
      await context.reply('У тебя пока нет подписок 📭')
      return
    }

    await this.deleteUserMessages(userId, chatId, 'subs')

    const total = user.subscriptions.length
    const articleList = user.subscriptions.join(', ')
    const firstBatch = Math.min(total, this.pageSize)

    const msg = await context.reply(
      `📋 У тебя ${this.formatSubscriptionsCount(total)}.\n\n` +
      `Артикулы: ${articleList}`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: `📦 Показать товары (${firstBatch})`, callback_data: `subsPage:0` }],
            [{ text: '📋 Вернуться в меню', callback_data: 'menu' }],
            [{ text: '❌ Отписаться от всех', callback_data: 'unsubAllConfirm' }]
          ]
        }
      }
    )

    this.trackUserMessage(userId, 'subs', msg.message_id)
  }

  /**
   * @param {import('telegraf').Context} context
   */
  async handleSubscriptionsPage(context) {
    const userId = context.from.id
    const chatId = context.chat.id
    const users = this.api.db.collection('users')
    const user = await users.findOne({ _id: userId })

    if (!user || user.subscriptions.length === 0) {
      await context.reply('Подписок больше нет 📭')
      return
    }

    const offset = Number(context.match[1]) || 0
    const productIds = user.subscriptions.slice(offset, offset + this.pageSize)
    const products = await this.api.getProducts(productIds)

    for (const product of products) {
      const cardMessage = this.formatProductCard(product)

      await this.deleteProductMessage(userId, chatId, product.id)

      const msg = await context.replyWithPhoto(cardMessage.photo, {
        caption: `${cardMessage.caption}\n\n✅ Ты подписан на этот товар`,
        parse_mode: cardMessage.parse_mode,
        reply_markup: {
          inline_keyboard: [
            [{ text: '❌ Отписаться', callback_data: `unsub:${product.id}` }]
          ]
        }
      })

      this.trackProductMessage(userId, product.id, msg.message_id)
    }

    const nextOffset = offset + this.pageSize

    if (nextOffset < user.subscriptions.length) {
      const msg = await context.reply(
        `Показано ${nextOffset} из ${user.subscriptions.length}.`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '➡️ Загрузить ещё', callback_data: `subsPage:${nextOffset}` }]
            ]
          }
        }
      )

      this.trackUserMessage(userId, 'subs', msg.message_id)
    } else {
      const msg = await context.reply(
        'Все подписки показаны ✅',
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '❌ Отписаться от всех', callback_data: 'unsubAllConfirm' }]
            ]
          }
        }
      )

      this.trackUserMessage(userId, 'subs', msg.message_id)
    }
  }

  /**
   * Russian pluralization for word "подписка"
   */
  formatSubscriptionsCount(count) {
    const lastDigit = count % 10
    const lastTwo = count % 100

    if (lastTwo >= 11 && lastTwo <= 19) return `${count} подписок`
    if (lastDigit === 1) return `${count} подписка`
    if (lastDigit >= 2 && lastDigit <= 4) return `${count} подписки`

    return `${count} подписок`
  }

  /**
   * @param {import('telegraf').Context} context
   */
  async handleUnsubAllConfirm(context) {
    await context.reply(
      '⚠️ Ты уверен? Это удалит все твои подписки, и я перестану присылать обновления.\n\n' +
      'Выбери действие:',
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '✅ Да, я всё понимаю, удалить все', callback_data: 'unsubAllExecute' }],
            [{ text: '❌ Я передумал, оставить подписки', callback_data: 'cancelUnsubAll' }]
          ]
        }
      }
    )
  }

  /**
   * @param {import('telegraf').Context} context
   */
  async handleUnsubAllExecute(context) {
    const userId = context.from.id
    const users = this.api.db.collection('users')

    await users.updateOne(
      { _id: userId },
      { $set: { subscriptions: [] } }
    )

    await context.reply('Все твои подписки удалены ❌')
  }

  /**
   * @param {object} user
   * @param {ProductCard} product
   * @returns {Promise<void>}
   */
  async notifyPriceChange(user, product) {
    const chatId = user._id
    const collection = this.db.collection('products')
    const dbProduct = await collection.findOne(
      { _id: product.id },
      { projection: { history: { $slice: -1 } } }
    )

    let diffLine
    const lastEntry = dbProduct?.history?.[0]

    if (lastEntry && lastEntry.priceCurrent !== product.priceCurrent) {
      diffLine = `💰 Цена изменилась: ${lastEntry.priceCurrent} ₽ → ${product.priceCurrent} ₽`
    } else {
      diffLine = `💰 Новая цена: ${product.priceCurrent} ₽`
    }

    const cardMessage = this.formatProductCard(product)

    try {
      await this.deleteProductMessage(chatId, chatId, product.id)

      const msg = await this.bot.telegram.sendPhoto(chatId, cardMessage.photo, {
        caption: `${diffLine}\n\n${cardMessage.caption}`,
        parse_mode: cardMessage.parse_mode,
        reply_markup: {
          inline_keyboard: [
            [{ text: '❌ Отписаться', callback_data: `unsub:${product.id}` }]
          ]
        }
      })

      this.trackProductMessage(chatId, product.id, msg.message_id)

      console.log(`[TgBot] notified user ${chatId} about price change for ${product.id}`)
    } catch (e) {
      console.error(`[TgBot] failed to notify user ${chatId}:`, e.message)
    }
  }

  /**
   * Ensure user storage initialized
   * @param {number} userId
   * @returns {UserMessages}
   */
  ensureUserMessages(userId) {
    if (!this.userMessages.has(userId)) {
      this.userMessages.set(userId, {
        menus: [],
        subs: [],
        products: new Map()
      })
    }
    return this.userMessages.get(userId)
  }

  /**
   * Track menu/subscription message
   * @param {number} userId
   * @param {'menus'|'subs'} type
   * @param {number} messageId
   */
  trackUserMessage(userId, type, messageId) {
    const data = this.ensureUserMessages(userId)
    data[type].push(messageId)
  }

  /**
   * Delete all messages of a given type
   * @param {number} userId
   * @param {number} chatId
   * @param {'menus'|'subs'} type
   */
  async deleteUserMessages(userId, chatId, type) {
    const data = this.ensureUserMessages(userId)

    for (const msgId of data[type]) {
      try {
        await this.bot.telegram.deleteMessage(chatId, msgId)
      } catch (err) {
        console.error(`[TgBot] Failed to delete ${type} message ${msgId}:`, err.message)
      }
    }

    data[type] = []
  }

  /**
   * Track product message by articleId
   * @param {number} userId
   * @param {number} articleId
   * @param {number} messageId
   */
  trackProductMessage(userId, articleId, messageId) {
    const data = this.ensureUserMessages(userId)
    data.products.set(articleId, messageId)
  }

  /**
   * Delete old product message if exists
   * @param {number} userId
   * @param {number} chatId
   * @param {number} articleId
   */
  async deleteProductMessage(userId, chatId, articleId) {
    const data = this.ensureUserMessages(userId)
    const msgId = data.products.get(articleId)

    if (msgId) {
      try {
        await this.bot.telegram.deleteMessage(chatId, msgId)
      } catch (err) {
        console.error(`[TgBot] Failed to delete product ${articleId} message:`, err.message)
      }
      data.products.delete(articleId)
    }
  }
}
