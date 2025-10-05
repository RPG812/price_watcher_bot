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
        menus: [],
        subs: [],
        products: new Map()
      })
    }

    return this.users.get(userId)
  }

  /**
   * @param {number} userId
   * @param {MessageType} type
   * @param {number} messageId
   */
  track(userId, type, messageId) {
    const data = this.ensureUser(userId)

    data[type].push(messageId)
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
   * Delete all messages of a given type
   * @param {number} userId
   * @param {number} chatId
   * @param {MessageType} type
   */
  async deleteUserMessages(userId, chatId, type) {
    const data = this.ensureUser(userId)

    for (const msgId of data[type]) {
      try {
        await this.bot.telegram.deleteMessage(chatId, msgId)
      } catch (e) {
        if (!e.message.includes('message to delete not found')) {
          console.error(`[MessageStore] Failed to delete ${type} message ${msgId}:`, e.message)
        }
      }
    }

    data[type] = []
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
   * Delete all messages for given user (menus, subs, products)
   * @param {number} userId
   * @param {number} chatId
   */
  async deleteAll(userId, chatId) {
    const data = this.ensureUser(userId)

    const all = [
      ...data.menus.map(id => ({ id, type: 'menu' })),
      ...data.subs.map(id => ({ id, type: 'subs' })),
      ...Array.from(data.products.values()).map(id => ({ id, type: 'product' }))
    ]

    for (const { id, type } of all) {
      try {
        await this.bot.telegram.deleteMessage(chatId, id)
      } catch (err) {
        console.error(`[MessageStore] Failed to delete ${type} message ${id}:`, err.message)
      }
    }

    this.users.set(userId, { menus: [], subs: [], products: new Map() })
  }
}
