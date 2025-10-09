import { Telegraf } from 'telegraf'
import { tg_token } from '../../auth/auth.mjs'
import { MessageStore } from './messages.mjs'
import { UserService } from './user-service.mjs'
import { createTrackedUi } from './tracked-ui.mjs'
import * as uiModule from './ui.mjs'

export class TgBot {
  /**
   * @param {import('./wbApi.mjs').WbApi} api
   */
  constructor (api) {
    this.api = api
    this.bot = new Telegraf(tg_token)
    this.msgStore = new MessageStore(this.bot)
    this.userService = new UserService(this.api.db)

    /** @type {typeof import('./ui.mjs')} */
    this.ui = createTrackedUi(uiModule, this.msgStore)
  }

  /**
   * @returns {Promise<void>}
   */
  async start () {
    this.initUserMiddleware()
    this.initHandlers()
    await this.bot.launch()

    setInterval(() => this.userService.cleanupCache(), 60 * 1000)

    console.log('[TgBot] started')
  }

  /**
   * @param {string} [reason]
   * @returns {Promise<void>}
   */
  async stop (reason = 'manual') {
    console.log(`[TgBot] stopping (${reason})...`)

    await this.bot.stop(reason)
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
    this.bot.use(async (ctx, next) => {
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
    })
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
      await this.ui.sendError(ctx)

      try {
        await this.ui.sendError(ctx)
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
      await this.ui.sendWelcome(ctx, user.firstName)
      console.log(`[TgBot] new user ${user._id} created`)
    } else {
      await this.ui.sendWelcomeBack(ctx, user.firstName)
    }

    await this.showMainMenu(ctx)
  }


  // /**
  //  * @param {Context} ctx
  //  * @return {Promise<void>}
  //  */
  // async handleStart(ctx) {
  //   const { user, isNew } = await this.userService.ensureUser(ctx.from)
  //
  //   await this.msgStore.deleteUserMessage(ctx)
  //
  //   if (isNew) {
  //     await this.ui.sendWelcome(ctx, user.firstName)
  //     console.log(`[TgBot] new user ${user._id} created`)
  //   } else {
  //     await this.ui.sendWelcomeBack(ctx, user.firstName)
  //   }
  //
  //   await this.showMainMenu(ctx)
  // }

  /**
   * @param {Context} ctx
   * @returns {Promise<void>}
   */
  async showMainMenu(ctx) {
    const hasSubscriptions = await this.userService.hasSubscriptions(ctx.from.id)

    await this.ui.sendMainMenu(ctx, hasSubscriptions)
  }

  /**
   * @param {Context} ctx
   * @returns {Promise<void>}
   */
  async handleSubscriptions(ctx) {
    await this.ui.sendSubscriptionsInfo(ctx, this.userService, this.api)
  }

  /**
   * @param {Context} ctx
   * @returns {Promise<void>}
   */
  async handleAddProduct(ctx) {
    await this.ui.sendAddProductHint(ctx)
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
   * @param {Context} ctx
   * @return {Promise<void>}
   */
  async handleText(ctx) {
    const userText = ctx.message.text.trim()

    if (userText.toLowerCase() === 'menu'){
      await this.showMainMenu(ctx)
      return
    } else if (userText.toLowerCase() === 'start'){
      await this.handleStart(ctx)
      return
    }

    // Try to extract a WB article (sequence of 5–10 digits)
    const match = userText.match(/\b\d{5,10}\b/)

    await this.msgStore.deleteUserMessage(ctx)

    if (!match) {
      await this.ui.sendUnknownText(ctx)
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
    const chatId = ctx.chat.id

    const [product] = await this.api.getProducts([productId])

    if (!product) {
      await this.ui.sendProductNotFound(ctx)
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
        await this.userService.removeSubscription(userId, product.id, sub.optionId)
        await this.ui.sendProductOutdated(ctx)

        return
      }
    } else {
      const mid = Math.floor(product.sizes.length / 2)
      const avg = product.sizes[mid]

      displayPrice = avg?.currentPrice || product.sizes[0]?.currentPrice || 0
    }

    await this.msgStore.deleteProduct(userId, chatId, productId)
    await this.ui.sendProductCard(ctx, { product, isSubscribed, displaySize, displayPrice })

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
      await this.ui.sendProductNotFound(ctx)
      return
    }

    if (product.sizes.length === 1) {
      const size = product.sizes[0]

      await this.userService.addSubscription(userId, productId, size.optionId)
      await this.ui.sendSubscribed(ctx, product)
    } else {
      await this.ui.sendSizeSelector(ctx, product)
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
      await this.ui.sendProductNotFound(ctx)
      return
    }

    const size = product.sizes.find(s => s.optionId === optionId)

    if (!size) {
      await this.ui.sendProductOutdated(ctx)
      return
    }

    await this.userService.addSubscription(userId, productId, optionId)
    await this.ui.sendSubscribed(ctx, product)

    await this.handleArticleInput(ctx, productId)
  }

  /**
   * Asks user to confirm single unsubscribe
   * @param {Context} ctx
   */
  async handleUnsubConfirm(ctx) {
    const [, productIdRaw, optionIdRaw] = ctx.match
    const productId = Number(productIdRaw)
    const optionId = Number(optionIdRaw)

    await this.ui.sendUnsubConfirm(ctx, productId, optionId)
  }

  /**
   * Executes single unsubscribe
   * @param {Context} ctx
   */
  async handleUnsubscribe(ctx) {
    const userId = ctx.from.id
    const chatId = ctx.chat.id

    const [, productIdRaw, optionIdRaw] = ctx.match
    const productId = Number(productIdRaw)
    const optionId = Number(optionIdRaw)

    await this.userService.removeSubscription(userId, productId, optionId)
    await this.msgStore.deleteProduct(userId, chatId, productId)
    await this.ui.sendUnsubscribed(ctx, productId)
  }

  /**
   * @param {Context} ctx
   * @returns {Promise<void>}
   */
  async handleUnsubAllConfirm(ctx) {
    await this.ui.sendUnsubAllConfirm(ctx)
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
    await this.ui.sendUnsubAllDone(ctx)

    await this.showMainMenu(ctx)
  }
}
