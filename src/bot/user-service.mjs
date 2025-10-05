export class UserService {
  // TODO добавить лог действий
  /**
   * @param {import('mongodb').Db} db
   */
  constructor(db) {
    /** @type {import('mongodb').Collection<User>} */
    this.collection = db.collection('users')
  }

  /**
   * @param {number} userId
   * @returns {Promise<User|null>}
   */
  async findById(userId) {
    return this.collection.findOne({ _id: userId })
  }

  /**
   * @param {User} user
   * @return {Promise<void>}
   */
  async create(user) {
    await this.collection.insertOne(user)
  }

  /** @param {number} userId */
  async updateActivity(userId) {
    await this.collection.updateOne(
      { _id: userId },
      { $set: { lastActiveAt: new Date() } }
    )
  }

  /**
   * Ensure user exists
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

  // ------- Subscriptions ------- //

  /**
   * Get all subscriptions
   * @param {number} userId
   * @returns {Promise<UserSubscription[]>}
   */
  async getSubscriptions(userId) {
    const user = await this.findById(userId)

    return user?.subscriptions || []
  }

  /**
   * Save subscriptions
   * @param {number} userId
   * @param {UserSubscription[]} subscriptions
   */
  async setSubscriptions(userId, subscriptions) {
    await this.collection.updateOne(
      { _id: userId },
      { $set: { subscriptions } }
    )
  }

  /**
   * Check if user has any subscriptions
   * @param {number} userId
   * @returns {Promise<boolean>}
   */
  async hasSubscriptions(userId) {
    const user = await this.collection.findOne(
      { _id: userId },
      { projection: { subscriptions: 1 } }
    )

    return !!(user?.subscriptions?.length)
  }

  /**
   * Add new subscription if not exists
   * @param {number} userId
   * @param {number} productId
   * @param {number} optionId
   */
  async addSubscription(userId, productId, optionId) {
    const subs = await this.getSubscriptions(userId)
    const exists = subs.some(s => s.productId === productId && s.optionId === optionId)

    if (!exists) {
      subs.push({ productId, optionId })
      await this.setSubscriptions(userId, subs)
    }
  }

  /**
   * Remove subscription by productId and optionId
   * @param {number} userId
   * @param {number} productId
   * @param {number} optionId
   */
  async removeSubscription(userId, productId, optionId) {
    const subs = await this.getSubscriptions(userId)
    const updated = subs.filter(s => !(s.productId === productId && s.optionId === optionId))

    await this.setSubscriptions(userId, updated)
  }

  /**
   * Remove all subscriptions
   * @param {number} userId
   */
  async clearSubscriptions(userId) {
    await this.setSubscriptions(userId, [])
  }
}
