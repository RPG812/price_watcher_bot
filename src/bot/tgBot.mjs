import { Telegraf } from 'telegraf'
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

  initHandlers() {
    this.bot.start(context => this.handleStart(context))
    this.bot.on('text', context => this.handleText(context))
  }

  /**
   * Handle /start command
   * @param {import('telegraf').Context} context
   */
  async handleStart(context) {
    console.log(`[handleStart] context:`, context) // DEBUG

    const userId = context.from.id
    const username = context.from.username || ''
    const firstName = context.from.first_name || ''
    const lastName = context.from.last_name || ''

    const users = this.api.db.collection('users')
    const existing = await users.findOne({ _id: userId })

    if (!existing) {
      await context.reply(`Привет, ${firstName}! 👋`)
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
      await context.reply(`С возвращением, ${firstName}! 👋`)
    }

    await context.reply('Пришли артикул WB, и я подпишу тебя на обновления')
  }


  async handleText(context) {
    const text = context.message.text.trim()
    const userId = context.from.id
    const users = this.api.db.collection('users')

    await users.updateOne(
      { _id: userId },
      { $set: { lastActiveAt: new Date() } }
    )

    if (/^\d+$/.test(text)) {
      const productId = Number(text)
      const products = await this.api.getProducts([productId])

      if (products.length > 0) {
        const product = products[0]

        const cardMessage = this.formatProductCard(product)
        await context.replyWithPhoto(cardMessage.photo, {
          caption: cardMessage.caption,
          parse_mode: cardMessage.parse_mode
        })

        await this.api.saveProduct(product)

        await users.updateOne(
          { _id: userId },
          { $addToSet: { subscriptions: productId } }
        )
        console.log(`[TgBot] user ${userId} subscribed to ${productId}`)

        await context.reply('Теперь я буду следить за ценой этого товара 👀')
      } else {
        await context.reply('Товар не найден')
      }
    } else {
      await context.reply('Пришли артикул (число)')
    }
  }

  /**
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
   * Start bot (polling)
   */
  async start() {
    this.initHandlers()

    await this.bot.launch()

    console.log('[TgBot] started')
  }

  /**
   * Stop bot gracefully
   */
  async stop(reason = 'manual') {
    console.log(`[TgBot] stopping (${reason})...`)
    await this.bot.stop(reason)
  }
}
