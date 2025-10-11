import { Telegraf } from 'telegraf'
import { TG_TOKEN } from '../../auth/auth.mjs'
import { MessageStore } from './messages.mjs'
import { UserService } from './user-service.mjs'
import { createTrackedUi } from './tracked-ui.mjs'
import * as ui from './ui.mjs'

export class TgBot {
  /**
   * @param {import('./wbApi.mjs').WbApi} api
   */
  constructor (api) {
    this.api = api
    this.bot = new Telegraf(TG_TOKEN)
    this.msgStore = new MessageStore(this.bot)
    this.userService = new UserService(this.api.db)

    /** @type {typeof import('./ui.mjs')} */
    this.ui = createTrackedUi(ui, this.msgStore)
  }

  /**
   * @returns {Promise<void>}
   */
  async start () {
    this.initUserMiddleware()
    this.initHandlers()

    this.bot.launch().then(() => {
      console.log('[TgBot] polling started')
    }).catch(console.error)

    this.cleanupCacheIntId = setInterval(() => this.userService.cleanupCache(), 60_000)

    console.log('[TgBot] started')
  }

  /**
   * @param {string} [reason]
   * @returns {Promise<void>}
   */
  async stop(reason = 'manual') {
    console.log(`[TgBot] stopping (${reason})...`)

    clearInterval(this.cleanupCacheIntId)
    await this.msgStore.destroy()
    await this.bot.stop(reason)

    console.log('[TgBot] stopped cleanly')
  }

  /**
   * Auto-patch Telegraf `bot.action` to always call `ctx.answerCbQuery()` first
   * @param {Bot} bot
   */
  patchBotAction(bot) {
    const origAction = bot.action.bind(bot)

    bot.action = (triggers, handler) => {
      const wrappedHandler = async (ctx, ...args) => {
        if (ctx?.callbackQuery) {
          await ctx.answerCbQuery().catch(() => {})
        }

        return handler(ctx, ...args)
      }

      return origAction(triggers, wrappedHandler)
    }
  }

  /**
   * Middleware: auto-run handleStart for new users
   */
  initUserMiddleware() {
    this.bot.use(/** @type {(ctx: Context, next: Function) => Promise<void>} */ (
      async (ctx, next) => {
        const id = ctx.from?.id

        if (!id) {
          return
        }

        try {
          const user = await this.userService.findById(id)

          if (!user) {
            if (ctx.update?.message?.text === '/start') {
              return next()
            }

            console.log(`[TgBot] First contact from user ${id} — redirecting to /start`)
            await this.handleStart(ctx)

            return
          }

          await this.userService.updateActivity(user._id)

          return next()
        } catch (err) {
          console.error(`[TgBot] Failed to ensure user ${id}: ${err.message}`)
          return next()
        }
      }))
  }

  /**
   *
   */
  initHandlers() {
    const { bot } = this

    this.patchBotAction(bot)

    bot.start(ctx => this.handleStart(ctx))

    bot.command('menu', ctx => this.showMainMenu(ctx))
    bot.action('menu', ctx => this.showMainMenu(ctx))
    bot.action('cancel', ctx => this.handleCancel(ctx))
    bot.action(/^delete:(\d+)$/, ctx => this.handleDeleteCard(ctx))

    bot.action('subscriptions', ctx => this.handleSubscriptions(ctx))
    bot.action('addProduct', ctx => this.handleAddProduct(ctx))

    bot.action(/^subscribe:(\d+)$/, ctx => this.handleSubscribe(ctx))
    bot.action(/^subsize:(\d+):(\d+)$/, ctx => this.handleSubscribeSize(ctx))

    // Ask confirmation before unsubscribing
    bot.action(/^unsub:(\d+):(\d+)$/, ctx => this.handleUnsubConfirm(ctx))
    bot.action('unsubAll', ctx => this.handleUnsubAllConfirm(ctx))
    // Execute unsubscribe after confirmation
    bot.action(/^unsubConfirm:(\d+):(\d+)$/, ctx => this.handleUnsubscribe(ctx))
    bot.action('unsubAllConfirm', ctx => this.handleUnsubAllExecute(ctx))

    bot.action(/^product:(\d+)$/, ctx => this.handleProductOpen(ctx))

    bot.on('text', ctx => this.handleText(ctx))

    bot.catch(async (err, ctx) => {
      console.error('[TgBot] Error:', err)

      try {
        await this.ui.replyError({ ctx })
      } catch (e) {
        console.error(`[TgBot] Failed to reply on error: ${e.message}`)
      }
    })
  }

  // -------- HANDLERS -------- //

  /**
   * @param {Context} ctx
   * @return {Promise<void>}
   */
  async handleStart(ctx) {
    const { user, isNew } = await this.userService.ensureUser(ctx.from)

    await this.msgStore.deleteUserMessage(ctx)

    if (isNew) {
      await this.ui.replyWelcome({ctx, firstName: user.firstName})
      console.log(`[TgBot] new user ${user._id} created`)
    } else {
      await this.ui.replyWelcomeBack({ctx, firstName: user.firstName})
    }

    await this.showMainMenu(ctx)
  }

  /**
   * @param {Context} ctx
   * @returns {Promise<void>}
   */
  async showMainMenu(ctx) {
    const hasSubscriptions = await this.userService.hasSubscriptions(ctx.from.id)

    await this.ui.replyMainMenu({ctx, hasSubscriptions})
  }

  /**
   * @param {Context} ctx
   * @returns {Promise<void>}
   */
  async handleSubscriptions(ctx) {
    await this.ui.replySubscriptionsInfo({ctx, userService: this.userService, api: this.api})
  }

  /**
   * @param {Context} ctx
   * @returns {Promise<void>}
   */
  async handleAddProduct(ctx) {
    await this.ui.replyAddProductHint({ctx})
  }

  /**
   * @param {Context} ctx
   * @returns {Promise<void>}
   */
  async handleCancel(ctx) {
    const chatId = ctx.chat.id
    const messageId = ctx.callbackQuery.message.message_id

    try {
      await this.msgStore.delete(chatId, messageId)
    } catch (e) {
      console.error('[TgBot] Failed to delete user message:', e.message)
    }
  }

  /**
   * Executes product card deletion
   * @param {Context} ctx
   */
  async handleDeleteCard(ctx) {
      const userId = ctx.from.id
      const chatId = ctx.chat.id
      const [, productIdRaw] = ctx.match
      const productId = Number(productIdRaw)

    try {
      await this.msgStore.deleteProduct(userId, chatId, productId)
    } catch (err) {
      console.error('[handleDeleteCard]', err)
      await this.ui.replyError({ ctx })
    }
  }


  /**
   * @param {Context} ctx
   * @return {Promise<void>}
   */
  async handleText(ctx) {
    const userText = ctx.message.text.trim()

    await this.msgStore.deleteUserMessage(ctx)

    if (userText.toLowerCase() === 'menu'){
      await this.showMainMenu(ctx)
      return
    } else if (userText.toLowerCase() === 'start'){
      await this.handleStart(ctx)
      return
    }

    // Try to extract a WB article (sequence of 5–10 digits)
    const match = userText.match(/\b\d{5,10}\b/)

    if (!match) {
      await this.ui.replyUnknownText({ ctx })
      await this.showMainMenu(ctx)

      return
    }

    const articleId = Number(match[0])

    await this.handleArticleInput(ctx, articleId)
  }

  /**
   * @param {Context} ctx
   * @param {number} productId
   * @return {Promise<void>}
   */
  async handleArticleInput(ctx, productId) {
    await this.handleProduct(ctx, productId, { updateActivity: true, saveProduct: true })
  }

  /**
   * @param {Context} ctx
   * @return {Promise<void>}
   */
  async handleProductOpen(ctx) {
    const productId = Number(ctx.match[1])

    await this.handleProduct(ctx, productId)
  }

  /**
   * Unified handler for product card logic
   * @param {Context} ctx
   * @param {number} productId
   * @param {Object} [options]
   * @param {boolean} [options.updateActivity]
   * @param {boolean} [options.saveProduct]
   * @returns {Promise<void>}
   */
  async handleProduct(ctx, productId, { updateActivity = false, saveProduct = false } = {}) {
    const userId = ctx.from.id
    // const chatId = ctx.chat.id

    const [product] = await this.api.getProducts([productId])

    if (!product) {
      await this.ui.replyProductNotFound({ctx})
      return
    }

    if (updateActivity) {
      await this.userService.updateActivity(userId)
    }

    // Determine subscription and display info
    const subs = await this.userService.getSubscriptions(userId)
    const sub = subs.find(s => s.productId === product.id)
    const isSubscribed = Boolean(sub)

    let displaySize = null
    let displayPrice = null

    if (isSubscribed) {
      const size = product.sizes.find(s => s.optionId === sub.optionId)

      if (size) {
        displaySize = size.name
        displayPrice = size.currentPrice
      } else {
        await this.userService.removeSubscription(userId, product.id)
        await this.ui.replyProductOutdated({ ctx })

        return
      }
    } else {
      const mid = Math.floor(product.sizes.length / 2)
      const avg = product.sizes[mid]

      displayPrice = avg?.currentPrice || product.sizes[0]?.currentPrice || 0
    }

    const card = ui.buildProductCard(product, {
      isSubscribed,
      displaySize,
      displayPrice
    })

    await this.ui.replyWithProductCard({ctx, card})

    if (saveProduct) {
      await this.api.saveProduct(product)
    }
  }

  /**
   * Handles click on "Subscribe" button
   * @param {Context} ctx
   */
  async handleSubscribe(ctx) {
    const userId = ctx.from.id
    const productId = Number(ctx.match[1])

    const [product] = await this.api.getProducts([productId])

    if (!product) {
      await this.ui.replyProductNotFound({ctx})
      return
    }

    if (product.sizes.length === 1) {
      const size = product.sizes[0]

      await this.userService.addSubscription(userId, productId, size.optionId)
      await this.handleArticleInput(ctx, productId)
      await this.ui.replySubscribed({ctx, product})
    } else {
      await this.ui.replySizeSelector({ctx, product})
    }
  }

  /**
   * Handles user selecting size for subscription
   * @param {Context} ctx
   */
  async handleSubscribeSize(ctx) {
    const userId = ctx.from.id
    const [, productIdRaw, optionIdRaw] = ctx.match
    const productId = Number(productIdRaw)
    const optionId = Number(optionIdRaw)

    const [product] = await this.api.getProducts([productId])

    if (!product) {
      await this.ui.replyProductNotFound({ctx})
      return
    }

    const size = product.sizes.find(s => s.optionId === optionId)

    if (!size) {
      await this.ui.replyProductOutdated({ ctx })
      return
    }

    await this.userService.addSubscription(userId, productId, optionId)
    await this.handleArticleInput(ctx, productId)
    await this.ui.replySubscribed({ctx, product})
  }

  /**
   * Asks user to confirm single unsubscribe
   * @param {Context} ctx
   */
  async handleUnsubConfirm(ctx) {
    const [, productIdRaw, optionIdRaw] = ctx.match
    const productId = Number(productIdRaw)
    const optionId = Number(optionIdRaw)

    await this.ui.replyUnsubConfirm({ctx, productId, optionId})
  }

  /**
   * Executes single unsubscribe
   * @param {Context} ctx
   */
  async handleUnsubscribe(ctx) {
    const userId = ctx.from.id
    const chatId = ctx.chat.id

    const [, productIdRaw] = ctx.match
    const productId = Number(productIdRaw)

    await this.userService.removeSubscription(userId, productId)
    await this.msgStore.deleteProduct(userId, chatId, productId)

    await this.ui.replyUnsubscribed({ ctx, productId })
  }

  /**
   * @param {Context} ctx
   * @returns {Promise<void>}
   */
  async handleUnsubAllConfirm(ctx) {
    await this.ui.replyUnsubAllConfirm({ctx})
  }

  /**
   * Executes removal of all user subscriptions
   * @param {Context} ctx
   */
  async handleUnsubAllExecute(ctx) {
    const userId = ctx.from.id
    const chatId = ctx.chat.id

    await this.msgStore.deleteAllProducts(userId, chatId)
    await this.userService.clearSubscriptions(userId)
    await this.ui.replyUnsubAllDone({ ctx })

    await this.showMainMenu(ctx)
  }

  /**
   * Notify user about price change for a product
   * @param {User} user
   * @param {ProductCard} product
   * @param {Array<{ optionId: number, name: string, prevPrice: number, currentPrice: number }>} changes
   * @returns {Promise<void>}
   */
  async notifyPriceChange(user, product, changes) {
    const chatId = user._id
    try {
      const { currentPrice, prevPrice } = changes[0]
      const captionPrefix = ui.buildPriceChangePrefix(prevPrice, currentPrice)

      const card = ui.buildProductCard(product, {
        isSubscribed: true,
        displayPrice: currentPrice,
        captionPrefix
      })

      await this.ui.sendProductCardPush({ bot: this.bot, chatId, card })

      console.log(`[TgBot] notified user ${chatId} about price change for product ${product.id}`)
    } catch (e) {
      console.error(`[TgBot] failed to notify user ${chatId}:`, e.message)
    }
  }
}
