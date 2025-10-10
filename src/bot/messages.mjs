import fs from 'fs/promises'
import path from 'path'

const STORE_PATH = path.resolve('./data/message-cache.json')
const TTL_DAYS = 7 // remove users inactive longer than 7 days

/**
 * Handles tracking and deletion of Telegram messages to keep chats clean.
 * Persists cache between restarts and auto-cleans inactive users.
 */
export class MessageStore {
  /**
   * @param {Bot} bot
   */
  constructor(bot) {
    this.bot = bot

    /** @type {Map<number, UserMessages>} */
    this.users = new Map()

    this._dirty = false
    this._saving = false

    this.load().catch(err => console.error('[MessageStore] Failed to load cache:', err.message))

    this.saveIntId = setInterval(() => this.save().catch(() => {}), 60_000)
    this.cleanupIntId = setInterval(() => this.cleanupInactive(TTL_DAYS), 60 * 60 * 1000)
  }

  /**
   * Ensure user message storage exists
   * @param {number} userId
   * @returns {UserMessages}
   * @private
   */
  ensureUser(userId) {
    const now = Date.now()

    if (!this.users.has(userId)) {
      this.users.set(userId, {
        products: new Map(),
        menu: null,
        temp: [],
        lastActive: now
      })
      this._dirty = true
    } else {
      this.users.get(userId).lastActive = now
    }

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
      if (!e.message.includes('message to delete not found')) {
        console.error(`[TgBot] Failed to delete cancel message: ${e.message}`)
      }
    }
  }

  /**
   * Track main menu message
   * @param {number} userId
   * @param {number} messageId
   */
  trackMenu(userId, messageId) {
    const data = this.ensureUser(userId)

    data.menu = messageId
    this._dirty = true
  }

  /**
   * Track temporary (short-lived) message
   * @param {number} userId
   * @param {number} messageId
   */
  trackTemp(userId, messageId) {
    const data = this.ensureUser(userId)

    data.temp.push(messageId)
    this._dirty = true
  }

  /**
   * Track product message
   * @param {number} userId
   * @param {number} productId
   * @param {number} messageId
   */
  trackProduct(userId, productId, messageId) {
    const data = this.ensureUser(userId)

    data.products.set(productId, messageId)
    this._dirty = true
  }

  /**
   * Delete menu message
   * @param {number} userId
   * @param {number} chatId
   */
  async deleteMenu(userId, chatId) {
    const data = this.ensureUser(userId)
    const msgId = data.menu

    if (!msgId) {
      return
    }

    try {
      await this.bot.telegram.deleteMessage(chatId, msgId)
    } catch (err) {
      if (!err.message.includes('message to delete not found')) {
        console.error(`[MessageStore] Failed to delete menu ${msgId}:`, err.message)
      }
    }

    data.menu = null
    this._dirty = true
  }

  /**
   * Delete all temporary messages
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
    this._dirty = true
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

    if (!msgId) {
      return
    }

    try {
      await this.bot.telegram.deleteMessage(chatId, msgId)
    } catch (err) {
      if (!err.message.includes('message to delete not found')) {
        console.error(`[MessageStore] Failed to delete product ${productId}:`, err.message)
      }
    }

    data.products.delete(productId)
    this._dirty = true
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
    this._dirty = true
  }

  // /**
  //  * Deletes all tracked messages for a user
  //  * @param {number} userId
  //  * @param {number} chatId
  //  */
  // async deleteAll(userId, chatId) {
  //   const data = this.ensureUser(userId)
  //   const all = [
  //     ...data.temp.map(id => ({ id, type: 'temp' })),
  //     ...Array.from(data.products.values()).map(id => ({ id, type: 'product' })),
  //     ...(data.menu ? [{ id: data.menu, type: 'menu' }] : [])
  //   ]
  //
  //   for (const { id, type } of all) {
  //     try {
  //       await this.bot.telegram.deleteMessage(chatId, id)
  //     } catch (err) {
  //       console.error(`[MessageStore] Failed to delete ${type} ${id}:`, err.message)
  //     }
  //   }
  //
  //   this.users.set(userId, { products: new Map(), temp: [], menu: null, lastActive: Date.now() })
  //   this._dirty = true
  // }

  /**
   * Save cache to disk
   * @private
   */
  async save() {
    if (this._saving || !this._dirty) {
      return
    }

    this._saving = true

    try {
      const data = {}

      for (const [userId, info] of this.users.entries()) {
        data[userId] = {
          menu: info.menu,
          temp: info.temp,
          products: Object.fromEntries(info.products),
          lastActive: info.lastActive
        }
      }

      await fs.mkdir(path.dirname(STORE_PATH), { recursive: true })
      await fs.writeFile(STORE_PATH, JSON.stringify(data))

      this._dirty = false
    } finally {
      this._saving = false
    }
  }


  /**
   * Load cache from disk (skips old users)
   * @private
   */
  async load() {
    try {
      const file = await fs.readFile(STORE_PATH, 'utf8')
      const json = JSON.parse(file)
      const now = Date.now()
      const cutoff = TTL_DAYS * 86400000
      let restored = 0

      for (const [userId, info] of Object.entries(json)) {
        if (now - (info.lastActive || 0) > cutoff) {
          continue
        }

        this.users.set(Number(userId), {
          products: new Map(Object.entries(info.products || {}).map(([k, v]) => [Number(k), v])),
          temp: info.temp || [],
          menu: info.menu || null,
          lastActive: info.lastActive || now
        })

        restored++
      }

      console.log(`[MessageStore] restored ${restored} active users`)
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error('[MessageStore] Failed to load file:', err.message)
      }
    }
  }

  /**
   * Removes inactive users from memory
   * @param {number} ttlDays
   */
  cleanupInactive(ttlDays) {
    const now = Date.now()
    const cutoff = ttlDays * 86400000
    let removed = 0

    for (const [userId, info] of this.users.entries()) {
      if (now - (info.lastActive || 0) > cutoff) {
        this.users.delete(userId)
        removed++
      }
    }

    if (removed > 0) {
      console.log(`[MessageStore] cleaned ${removed} inactive users`)
      this._dirty = true
    }
  }

  /**
   * Persist cache before shutdown
   */
  async destroy() {
    clearInterval(this.saveIntId)
    clearInterval(this.cleanupIntId)

    await this.save()
  }
}
