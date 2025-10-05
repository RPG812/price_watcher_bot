import { Telegraf } from 'telegraf'
import { tg_token } from '../../auth/auth.mjs'
import * as ui from './ui.mjs'
import { MessageStore } from './messages.mjs'
import { UserService } from './user-service.mjs'

export class TgBot {
  /**
   * @param {import('./wbApi.mjs').WbApi} api
   */
  constructor (api) {
    this.api = api
    this.bot = new Telegraf(tg_token)
    this.msgStore = new MessageStore(this.bot)
    this.userService = new UserService(this.api.db)
  }

  /**
   * @returns {Promise<void>}
   */
  async start () {
    this.initHandlers()
    await this.bot.launch()

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
   *
   */
  initHandlers() {
    const { bot } = this

    bot.start(ctx => this.handleStart(ctx))

    bot.command('menu', ctx => this.showMainMenu(ctx))
    bot.action('menu', ctx => this.showMainMenu(ctx))
    bot.action('cancel', ctx => this.handleCancel(ctx))

    bot.action('subscriptions', ctx => this.handleSubscriptions(ctx))
    bot.action('addProduct', ctx => this.handleAddProduct(ctx))
    bot.action('unsubAll', ctx => this.handleUnsubAllConfirm(ctx))

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
        await ctx.reply('⚠️ Что-то пошло не так, попробуй позже')
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

    if (isNew) {
      await ui.sendWelcome(ctx, user.firstName)
      console.log(`[TgBot] new user ${user._id} created`)
    } else {
      await ui.sendWelcomeBack(ctx, user.firstName)
    }

    await this.showMainMenu(ctx)
  }

  /**
   * @param {Context} ctx
   * @returns {Promise<void>}
   */
  async showMainMenu(ctx) {
    const { id: userId } = ctx.from
    const { id: chatId } = ctx.chat

    await this.msgStore.deleteUserMessages(userId, chatId, 'menus')

    const hasSubscriptions = await this.userService.hasSubscriptions(userId)

    const {message_id: msgId} = await ui.sendMainMenu(ctx, hasSubscriptions)

    this.msgStore.track(userId, 'menus', msgId)
  }

  /**
   * @param {Context} ctx
   * @returns {Promise<void>}
   */
  async handleSubscriptions(ctx) {
    await this.msgStore.deleteUserMessages(ctx.from.id, ctx.chat.id, 'menus')
    await ui.sendSubscriptionsInfo(ctx, this.userService, this.api)
  }

  /**
   * @param {Context} ctx
   * @returns {Promise<void>}
   */
  async handleAddProduct(ctx) {
    await ui.sendAddProductHint(ctx)
  }
  /**
   * @param {Context} ctx
   * @returns {Promise<void>}
   */
  async handleCancel(ctx) {
    const chatId = ctx.chat.id
    const messageId = ctx.message.message_id

    try {
      await this.msgStore.delete(chatId, messageId)
    } catch (e) {
      console.error('[TgBot] Failed to delete user message:', e.message)
    }
  }

  /**
   * @param {Context} ctx
   */
  async handleProductOpen(ctx) {
    const userId = ctx.from.id
    const chatId = ctx.chat.id
    const productId = Number(ctx.match[1])

    const [product] = await this.api.getProducts([productId])

    if (!product) {
      await ui.sendProductNotFound(ctx)

      return
    }

    await this.msgStore.deleteProduct(userId, chatId, productId)

    const msg = await ui.sendProductCard(ctx, product)

    this.msgStore.trackProduct(userId, productId, msg.message_id)
  }

  /**
   * @param {Context} ctx
   * @return {Promise<void>}
   */
  async handleText(ctx) {
    const chatId = ctx.chat.id
    const messageId = ctx.message.message_id
    const userText = ctx.message.text.trim()

    try {
      await this.msgStore.delete(chatId, messageId)
    } catch (e) {
      console.error('[TgBot] Failed to delete user message:', e.message)
    }

    // Try to extract a WB article (sequence of 5–10 digits)
    const match = userText.match(/\b\d{5,10}\b/)

    if (!match) {
      await ui.sendUnknownText(ctx)
      await this.showMainMenu(ctx)

      return
    }

    const articleId = Number(match[0])

    await this.handleArticleInput(ctx, articleId)
  }

  /**
   * Handles product article input from user
   * @param {Context} ctx
   * @param {number} productId
   * @returns {Promise<void>}
   */
  async handleArticleInput(ctx, productId) {
    const chatId = ctx.chat.id
    const userId = ctx.from.id

    // Load product info
    const products = await this.api.getProducts([productId])

    if (products.length === 0) {
      await ui.sendProductNotFound(ctx)
      return
    }

    const product = products[0]

    // Update user's activity and get subscriptions
    await this.userService.updateActivity(userId)
    const subs = await this.userService.getSubscriptions(userId)

    // Check if user is subscribed to this product
    const sub = subs.find(s => s.productId === productId)
    const isSubscribed = Boolean(sub)

    // Clean up previous card (if exists)
    await this.msgStore.deleteProduct(userId, chatId, productId)

    // Determine price and size label for card
    let displaySize = null
    let displayPrice = null

    if (isSubscribed) {
      const size = product.sizes.find(s => s.optionId === sub.optionId)

      if (size) {
        displaySize = size.name
        displayPrice = size.currentPrice
      } else {
        await this.userService.removeSubscription(userId, productId, sub.optionId)
        await ui.sendProductOutdated(ctx)
        return
      }
    } else {
      const mid = Math.floor(product.sizes.length / 2)
      const avg = product.sizes[mid]

      displayPrice = avg?.currentPrice || product.sizes[0]?.currentPrice || 0
    }

    // Send main product card
    const {message_id: cardMsgId} = await ui.sendProductCard(ctx, {
      product,
      isSubscribed,
      displaySize,
      displayPrice
    })

    this.msgStore.trackProduct(userId, productId, cardMsgId)

    await this.api.saveProduct(product)
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
      await ui.sendProductNotFound(ctx)
      return
    }

    if (product.sizes.length === 1) {
      const size = product.sizes[0]

      await this.userService.addSubscription(userId, productId, size.optionId)
      await ui.sendSubscribed(ctx, product, size)
    } else {
      await ui.sendSizeSelector(ctx, product)
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
      await ui.sendProductNotFound(ctx)
      return
    }

    const size = product.sizes.find(s => s.optionId === optionId)

    if (!size) {
      await ui.sendProductOutdated(ctx)
      return
    }

    await this.userService.addSubscription(userId, productId, optionId)
    await ui.sendSubscribed(ctx, product)

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

    await ui.sendUnsubConfirm(ctx, productId, optionId)
  }

  /**
   * Executes single unsubscribe
   * @param {Context} ctx
   */
  async handleUnsubscribe(ctx) {
    const userId = ctx.from.id
    const [, productIdRaw, optionIdRaw] = ctx.match
    const productId = Number(productIdRaw)
    const optionId = Number(optionIdRaw)

    await this.userService.removeSubscription(userId, productId, optionId)
    await ui.sendUnsubscribed(ctx)

    await this.handleArticleInput(ctx, productId)
  }

  /**
   * @param {Context} ctx
   * @returns {Promise<void>}
   */
  async handleUnsubAllConfirm(ctx) {
    await ui.sendUnsubAllConfirm(ctx)

    await this.showMainMenu(ctx)
  }

  /**
   * Executes removal of all user subscriptions
   * @param {Context} ctx
   */
  async handleUnsubAllExecute(ctx) {
    const userId = ctx.from.id

    await this.userService.clearSubscriptions(userId)
    await ui.sendUnsubAllDone(ctx)

    // Optional: show menu after cleanup
    await this.showMainMenu(ctx)
  }

}
