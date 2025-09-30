import { Markup, Telegraf } from 'telegraf'
import { tg_token } from '../../auth/auth.mjs'

/**
 * Telegram Bot wrapper
 */
export class TgBot {
  /**
   * @param {import('./wbApi.mjs').WbApi} api - instance of WbApi
   */
  constructor(api) {
    this.api = api
    this.bot = new Telegraf(tg_token)
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
    this.bot.start(context => this.handleStart(context))
    this.bot.on('text', context => this.handleText(context))
    this.bot.command('subs', context => this.handleSubscriptions(context))
    this.bot.action(/unsub:(\d+)/, context => this.handleUnsubConfirm(context))
    this.bot.action(/confirmUnsub:(\d+)/, context => this.handleUnsubExecute(context))
    this.bot.action(/sub:(\d+)/, context => this.handleSubscribe(context))
  }

  /**
   * Handle /start command
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

    await context.reply('Пришли артикул WB, и я покажу карточку 📦')
  }

  /**
   * Handle text messages
   * @param {import('telegraf').Context} context
   */
  async handleText(context) {
    const text = context.message.text.trim()

    if (/^\d+$/.test(text)) {
      await this.handleArticleInput(context, Number(text))
    } else {
      await context.reply('Пришли артикул (число)')
    }
  }

  /**
   * Process article input from user
   * @param {import('telegraf').Context} context
   * @param {number} productId
   */
  async handleArticleInput(context, productId) {
    const userId = context.from.id
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

    let keyboard

    if (isSubscribed) {
      keyboard = {
        reply_markup: {
          inline_keyboard: [
            [{ text: '❌ Отписаться', callback_data: `unsub:${product.id}` }]
          ]
        }
      }

      await context.replyWithPhoto(cardMessage.photo, {
        caption: `${cardMessage.caption}\n\n✅ Ты уже подписан на этот товар`,
        parse_mode: cardMessage.parse_mode,
        ...keyboard
      })
    } else {
      keyboard = {
        reply_markup: {
          inline_keyboard: [
            [{ text: '✅ Подписаться', callback_data: `sub:${product.id}` }]
          ]
        }
      }

      await context.replyWithPhoto(cardMessage.photo, {
        caption: cardMessage.caption,
        parse_mode: cardMessage.parse_mode,
        ...keyboard
      })
    }

    await this.api.saveProduct(product)
  }


  /**
   * Subscribe user to product
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
   * Format product card message for Telegram
   * @param {import('./wbApi.mjs').ProductCard} product
   * @returns {{ photo: string, caption: string, parse_mode: string }}
   */
  formatProductCard(product) {
    const priceLine = product.priceOriginal > product.priceCurrent
      ? `💰 Цена: ${product.priceCurrent} ₽  ~~${product.priceOriginal} ₽~~`
      : `💰 Цена: ${product.priceCurrent} ₽`

    const ratingLine = product.rating
      ? `⭐️ Рейтинг: ${product.rating} (${product.feedbacks} отзывов)`
      : ''

    const caption =
      `📦 ${product.name}\n` +
      (product.brand ? `🏷 Бренд: ${product.brand}\n` : '') +
      priceLine + '\n' +
      (ratingLine ? ratingLine + '\n' : '') +
      `🔗 [Открыть на WB](${product.link})`

    return {
      photo: product.imageURL,
      caption,
      parse_mode: 'Markdown'
    }
  }

  /**
   * Handle /subs command
   * @param {import('telegraf').Context} context
   */
  async handleSubscriptions(context) {
    const userId = context.from.id
    const users = this.api.db.collection('users')

    const user = await users.findOne({ _id: userId })

    if (!user || user.subscriptions.length === 0) {
      await context.reply('У тебя пока нет подписок 📭')
      return
    }

    const products = await this.api.getProducts(user.subscriptions)

    let msg = '📋 Твои подписки:\n\n'
    for (const product of products) {
      msg += `— ${product.name} (${product.id}): ${product.priceCurrent} ₽\n`
    }

    await context.reply(msg)
  }

  /**
   * Ask confirmation for unsubscribe
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
   * @param {import('telegraf').Context} context
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
}
