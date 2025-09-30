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
    this.bot.command('subs', context => this.handleSubscriptions(context))
    this.bot.action(/subsPage:(\d+)/, context => this.handleSubscriptionsPage(context))
    this.bot.action(/unsub:(\d+)/, context => this.handleUnsubConfirm(context))
    this.bot.action(/confirmUnsub:(\d+)/, context => this.handleUnsubExecute(context))
    this.bot.action(/sub:(\d+)/, context => this.handleSubscribe(context))
    this.bot.on('text', context => this.handleText(context))

    this.bot.catch(async (err, context) => {
      console.error('[TgBot] Error:', err)
      try {
        await context.reply('⚠️ Ошибка, попробуй чуть позже')
      } catch (e) {
        console.error('[TgBot] Failed to reply on error:', e.message)
      }
    })
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
    const ratingLine = product.rating
      ? `⭐️ ${product.rating} (${product.feedbacks} отзывов)`
      : ''

    const stockLine = product.stock > 0
      ? `📦 В наличии: ${product.stock} шт.`
      : '❌ Нет в наличии'

    const caption =
      `📦 ${product.name}\n\n` +
      `💰 Цена: ${product.priceCurrent} ₽` + '\n\n' +
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

  /**
   * Handle /subs command: show subscriptions with pagination
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

    const total = user.subscriptions.length
    const articleList = user.subscriptions.join(', ')
    const pageSize = 10
    const firstBatch = Math.min(total, pageSize)

    await context.reply(
      `📋 У тебя ${this.formatSubscriptionsCount(total)}.\n\n` +
      `Артикулы: ${articleList}`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: `📦 Показать товары (${firstBatch})`, callback_data: `subsPage:0` }]
          ]
        }
      }
    )
  }

  /**
   * Show subscription products page
   * @param {import('telegraf').Context} context
   */
  async handleSubscriptionsPage(context) {
    const userId = context.from.id
    const users = this.api.db.collection('users')

    const user = await users.findOne({ _id: userId })
    if (!user || user.subscriptions.length === 0) {
      await context.reply('Подписок больше нет 📭')
      return
    }

    const parts = context.match[1].split(':')
    const offset = Number(parts[0]) || 0
    const pageSize = 10

    const productIds = user.subscriptions.slice(offset, offset + pageSize)
    const products = await this.api.getProducts(productIds)

    for (const product of products) {
      const cardMessage = this.formatProductCard(product)
      await context.replyWithPhoto(cardMessage.photo, {
        caption: `${cardMessage.caption}\n\n✅ Ты подписан на этот товар`,
        parse_mode: cardMessage.parse_mode,
        reply_markup: {
          inline_keyboard: [
            [{ text: '❌ Отписаться', callback_data: `unsub:${product.id}` }]
          ]
        }
      })
    }

    const nextOffset = offset + pageSize

    if (nextOffset < user.subscriptions.length) {
      await context.reply(
        `Показано ${nextOffset} из ${user.subscriptions.length}.`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '➡️ Загрузить ещё', callback_data: `subsPage:${nextOffset}` }]
            ]
          }
        }
      )
    } else {
      await context.reply('Все подписки показаны ✅')
    }
  }

  /**
   * Russian pluralization for word "подписка"
   * @param {number} count
   * @returns {string}
   */
  formatSubscriptionsCount(count) {
    const lastDigit = count % 10
    const lastTwo = count % 100

    if (lastTwo >= 11 && lastTwo <= 19) {
      return `${count} подписок`
    }

    if (lastDigit === 1) {
      return `${count} подписка`
    }

    if (lastDigit >= 2 && lastDigit <= 4) {
      return `${count} подписки`
    }

    return `${count} подписок`
  }

}
