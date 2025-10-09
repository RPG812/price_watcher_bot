/**
 * Handles tracking and deletion of Telegram messages to keep chats clean.
 */
export class MessageStore {
  /**
   * @param {Bot} bot
   */
  constructor(bot) {
    this.bot = bot

    /** @type {Map<number, UserMessages>} */
    this.users = new Map()
  }

  /**
   * Ensure user message storage exists
   * @param {number} userId
   * @returns {UserMessages}
   * @private
   */
  ensureUser(userId) {
    if (!this.users.has(userId)) {
      this.users.set(userId, {
        products: new Map(),
        menu: null,
        temp: []
      })
    }

    console.log(this.users.get(userId))

    return this.users.get(userId)
  }

  /**
   * Delete a single message by chatId and messageId
   * @param {number} chatId
   * @param {number} messageId
   */
  async delete(chatId, messageId) {
    try {
      await this.bot.telegram.deleteMessage(chatId, messageId)
    } catch (e) {
      if (!e.message.includes('message to delete not found')) {
        console.error(`[MessageStore] Failed to delete message ${messageId}:`, e.message)
      }
    }
  }

  /**
   * Delete last users message
   * @param {Context} ctx
   */
  async deleteUserMessage(ctx) {
    try {
      await ctx.deleteMessage()
    } catch (e) {
      console.error(`[TgBot] Failed to delete cancel message: ${e.message}`)
    }
  }

  /**
   * Tracks temporary (short-lived) message
   * @param {number} userId
   * @param {number} messageId
   */
  trackMenu(userId, messageId) {
    const data = this.ensureUser(userId)

    data.menu = messageId
  }

  /**
   * Tracks temporary (short-lived) message
   * @param {number} userId
   * @param {number} messageId
   */
  trackTemp(userId, messageId) {
    const data = this.ensureUser(userId)

    data.temp.push(messageId)
  }

  /**
   * Track a product message
   * @param {number} userId
   * @param {number} productId
   * @param {number} messageId
   */
  trackProduct(userId, productId, messageId) {
    const data = this.ensureUser(userId)

    data.products.set(productId, messageId)
  }

  /**
   * @param {number} userId
   * @param {number} chatId
   * @return {Promise<void>}
   */
  async deleteMenu(userId, chatId) {
    const data = this.ensureUser(userId)
    const msgId = data.menu

    if (!msgId) return

    try {
      await this.bot.telegram.deleteMessage(chatId, msgId)
    } catch (err) {
      if (!err.message.includes('message to delete not found')) {
        console.error(`[MessageStore] Failed to delete menu ${msgId}:`, err.message)
      }
    }

    data.menu = null
  }

  /**
   * Deletes all temporary messages
   * @param {number} userId
   * @param {number} chatId
   */
  async deleteTemp(userId, chatId) {
    const data = this.ensureUser(userId)

    for (const msgId of data.temp) {
      try {
        await this.bot.telegram.deleteMessage(chatId, msgId)
      } catch (err) {
        if (!err.message.includes('message to delete not found')) {
          console.error(`[MessageStore] Failed to delete temp message ${msgId}:`, err.message)
        }
      }
    }

    data.temp = []
  }

  /**
   * Delete product message by productId
   * @param {number} userId
   * @param {number} chatId
   * @param {number} productId
   */
  async deleteProduct(userId, chatId, productId) {
    const data = this.ensureUser(userId)
    const msgId = data.products.get(productId)

    if (msgId) {
      try {
        await this.bot.telegram.deleteMessage(chatId, msgId)
      } catch (err) {
        if (!err.message.includes('message to delete not found')) {
          console.error(`[MessageStore] Failed to delete product ${productId}:`, err.message)
        }
      }

      data.products.delete(productId)
    }
  }

  /**
   * Deletes all product messages for a user
   * @param {number} userId
   * @param {number} chatId
   */
  async deleteAllProducts(userId, chatId) {
    const data = this.ensureUser(userId)

    for (const [productId, msgId] of data.products.entries()) {
      try {
        await this.bot.telegram.deleteMessage(chatId, msgId)
      } catch (err) {
        if (!err.message.includes('message to delete not found')) {
          console.error(`[MessageStore] Failed to delete product ${productId}:`, err.message)
        }
      }
    }

    data.products.clear()
  }


  /**
   * @param {number} userId
   * @param {number} chatId
   */
  async deleteAll(userId, chatId) {
    const data = this.ensureUser(userId)
    const all = [
      ...data.temp.map(id => ({ id, type: 'temp' })),
      ...Array.from(data.products.values()).map(id => ({ id, type: 'product' })),
      ...(data.menu ? [{ id: data.menu, type: 'menu' }] : [])
    ]

    for (const { id, type } of all) {
      try {
        await this.bot.telegram.deleteMessage(chatId, id)
      } catch (err) {
        console.error(`[MessageStore] Failed to delete ${type} ${id}:`, err.message)
      }
    }

    this.users.set(userId, { products: new Map(), temp: [], menu: null })
  }
}
