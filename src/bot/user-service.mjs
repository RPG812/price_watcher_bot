export class UserService {
  /**
   * @param {import('mongodb').Db} db
   * @param {object} [options]
   * @param {number} [options.ttlMs=600000]  // 10 минут
   */
  constructor(db, { ttlMs = 10 * 60 * 1000 } = {}) {
    /** @type {import('mongodb').Collection<User>} */
    this.collection = db.collection('users')

    this.cache = new Map()
    this.ttlMs = ttlMs
  }

  // ---------- INTERNAL ---------- //

  /**
   * @param {CacheEntry<User>} entry
   * @returns {boolean}
   */
  _isCacheValid(entry) {
    return entry && (Date.now() - entry.ts < this.ttlMs)
  }

  /**
   * @param {number} userId
   * @returns {User|null}
   */
  _getFromCache(userId) {
    const entry = this.cache.get(userId)

    if (!this._isCacheValid(entry)) {
      this.cache.delete(userId)
      return null
    }

    return entry.data
  }

  /**
   * @param {User} user
   */
  _setCache(user) {
    this.cache.set(user._id, { data: user, ts: Date.now() })
  }

  // ---------- CORE ---------- //

  /**
   * @param {number} userId
   * @returns {Promise<User|null>}
   */
  async findById(userId) {
    const cached = this._getFromCache(userId)

    if (cached) {
      return cached
    }

    const user = await this.collection.findOne({ _id: userId })

    if (user) {
      this._setCache(user)
    }

    return user
  }

  /**
   * @param {User} user
   * @return {Promise<void>}
   */
  async create(user) {
    await this.collection.insertOne(user)
    this._setCache(user)
  }

  /**
   * @param {number} userId
   * @return {Promise<void>}
   */
  async updateActivity(userId) {
    const now = new Date()

    await this.collection.updateOne(
      { _id: userId },
      { $set: { lastActiveAt: now } }
    )

    const cached = this._getFromCache(userId)

    if (cached) {
      cached.lastActiveAt = now
      this._setCache(cached)
    }
  }

  /**
   * @param {TelegramUserInput} from
   * @returns {Promise<{ user: User, isNew: boolean }>}
   */
  async ensureUser(from) {
    const userId = from.id
    const existing = await this.findById(userId)
    const now = new Date()

    if (!existing) {
      const newUser = {
        _id: userId,
        username: from.username || '',
        firstName: from.first_name || '',
        lastName: from.last_name || '',
        subscriptions: [],
        createdAt: now,
        lastActiveAt: now
      }

      await this.create(newUser)

      return { user: newUser, isNew: true }
    }

    await this.updateActivity(userId)

    return { user: existing, isNew: false }
  }

  // ---------- SUBSCRIPTIONS ---------- //

  /**
   * @param {number} userId
   * @returns {Promise<UserSubscription[]>}
   */
  async getSubscriptions(userId) {
    const cached = this._getFromCache(userId)

    if (cached) {
      return cached.subscriptions || []
    }

    const user = await this.findById(userId)

    return user?.subscriptions || []
  }

  /**
   * @param {number} userId
   * @param {UserSubscription[]} subscriptions
   * @return {Promise<void>}
   */
  async setSubscriptions(userId, subscriptions) {
    await this.collection.updateOne(
      { _id: userId },
      { $set: { subscriptions } }
    )

    const cached = this._getFromCache(userId)

    if (cached) {
      cached.subscriptions = subscriptions
      this._setCache(cached)
    }
  }

  /**
   * @param {number} userId
   * @returns {Promise<boolean>}
   */
  async hasSubscriptions(userId) {
    const subs = await this.getSubscriptions(userId)

    return subs.length > 0
  }

  /**
   * @param {number} userId
   * @param {number} productId
   * @param {number} optionId
   * @return {Promise<void>}
   */
  async addSubscription(userId, productId, optionId) {
    const user = this._getFromCache(userId) || await this.findById(userId)

    if (!user) {
      return
    }

    const subs = user.subscriptions || []
    const exists = subs.some(s => s.productId === productId && s.optionId === optionId)

    if (exists) {
      return
    }

    const updated = [...subs, { productId, optionId }]

    user.subscriptions = updated
    this._setCache(user)

    await this.setSubscriptions(userId, updated)
  }

  /**
   * @param {number} userId
   * @param {number} productId
   * @param {number} optionId
   * @return {Promise<void>}
   */
  async removeSubscription(userId, productId, optionId) {
    const user = this._getFromCache(userId) || await this.findById(userId)

    if (!user) {
      return
    }

    const updated = /** @type {UserSubscription[]} */ (user.subscriptions || []).filter(
      s => !(s.productId === productId && s.optionId === optionId)
    )

    user.subscriptions = updated
    this._setCache(user)

    await this.setSubscriptions(userId, updated)
  }

  /**
   * @param {number} userId
   * @return {Promise<void>}
   */
  async clearSubscriptions(userId) {
    const user = this._getFromCache(userId) || await this.findById(userId)

    if (!user) {
      return
    }

    user.subscriptions = []
    this._setCache(user)

    await this.setSubscriptions(userId, [])
  }

  // ---------- UTILS ---------- //

  /**
   * @return {void}
   */
  cleanupCache() {
    const now = Date.now()

    for (const [userId, entry] of this.cache.entries()) {
      if (now - entry.ts > this.ttlMs) {
        this.cache.delete(userId)
      }
    }
  }
}
