import { Buffer } from 'node:buffer'
import { MongoClient } from 'mongodb'
import basketMap from './basketMap.mjs'

const CATALOG_URL = 'https://www.wildberries.ru/catalog'
const CARD_URL = 'https://u-card.wb.ru/cards/v4/list'
const HEADERS = {
  'User-Agent': 'Mozilla/5.0',
  'Accept': 'application/json'
}
const DEFAULT_PARAMS = {
  appType: '1',
  curr: 'rub',
  dest: '-1185367', // TODO
  spp: '30',
  ab_testing: 'false',
  lang: 'ru',
  ignore_stocks: 'true'
}

/**
 * Wildberries API + Mongo wrapper
 */
export class WbApi {
  constructor() {
    this.dbURL = 'mongodb://127.0.0.1:27017'
    this.dbName = 'wb'
    this.dbClient = null
    this.db = null

    this.priceWatcherId = null
    this.watchInterval = 5 * 60 * 1000
    this.threshold = 60 * 60 * 1000

    this.notifiLimit = 5
  }

  /**
   * @returns {Promise<boolean>}
   */
  async initDb() {
    while (!this.dbClient && !this.db) {
      try {
        this.dbClient = await MongoClient.connect(this.dbURL)
        this.db = this.dbClient.db(this.dbName)

        console.log(`[WbApi] connected to DB ${this.dbURL} ${this.dbName}`)

        return true
      } catch (e) {
        console.error(e.message)

        await new Promise(resolve => setTimeout(resolve, 30000))
      }
    }
  }

  /**
   * @returns {Promise<void>}
   */
  async setupMongo() {
    const collectionsConfig = [
      {
        name: 'products',
        indexes: [
          { key: { id: 1 }, name: 'id_1', unique: true },
          { key: { id: 1, lastCheckedAt: 1 }, name: 'id_lastCheckedAt_1' }
        ]
      },
      {
        name: 'users',
        indexes: [
          { key: { 'subscriptions.productId': 1 }, name: 'subscriptions_productId_1' },
          { key: { 'subscriptions.optionId': 1 }, name: 'subscriptions_optionId_1' }
        ]
      },
      {
        name: 'price_history',
        indexes: [
          { key: { productId: 1, optionId: 1, date: -1 }, name: 'productId_optionId_date_desc' },
          { key: { date: -1 }, name: 'date_desc' }
        ]
      }
    ]

    const existing = await this.db.listCollections().toArray()
    const existingNames = new Set(existing.map(c => c.name))

    for (const col of collectionsConfig) {
      if (!existingNames.has(col.name)) {
        console.log(`[mongo] create collection: ${col.name}`)

        await this.db.createCollection(col.name)
      }

      const collection = this.db.collection(col.name)

      for (const idx of col.indexes) {
        const exists = await collection.indexExists(idx.name)

        if (!exists) {
          console.log(`[mongo] create index on ${col.name}: ${idx.name}`)

          await collection.createIndex(idx.key, {
            name: idx.name,
            unique: Boolean(idx.unique),
            background: true
          })
        } else {
          console.debug(`[mongo] index already exists: ${col.name}.${idx.name}`)
        }
      }
    }
  }

  /**
   * @param {Array<string|number>} ids
   * @return {Promise<ProductCard[]>}
   */
  async getProducts(ids) {
    const url = this.buildUrl(ids)

    try {
      const res = await fetch(url, { headers: HEADERS })

      if (!res.ok) {
        console.warn(`[getProducts] fetch failed: ${res.status}`)
        return []
      }

      const data = /** @type {{ products?: RawProduct[] }} */ await res.json()

      if (!data.products) {
        return []
      }

      const result = []

      for (const product of data.products) {
        try {
          const card = await this.getCard(product)

          result.push(card)
        } catch (e) {
          console.error(`[getProducts] error building card id=${product.id}:`, e.message)
        }
      }

      return result
    } catch (e) {
      console.error(`[getProducts] fetch error:`, e.message)
      return []
    }
  }

  /**
   * @param {RawProduct} product
   * @returns {Promise<ProductCard>}
   */
  async getCard(product) {
    const id = Number(product.id)
    const imageURL = this.buildImageUrl(product)

    const existing = await this.db.collection('products').findOne(
      { id },
      { projection: { image: 1 } }
    )

    let image = existing?.image || null

    if (!image) {
      image = await this.getImageStr(imageURL)
    }

    const sizes = (product.sizes || []).map(size => {
      const originalPrice = size.price?.basic ? size.price.basic / 100 : 0
      const currentPrice = size.price?.product ? size.price.product / 100 : 0
      const walletPrice = currentPrice ? Math.floor(currentPrice * 0.94) : 0 // TODO

      return {
        name: size.name || '',
        origName: size.origName || '',
        optionId: size.optionId || null,
        originalPrice,
        currentPrice,
        walletPrice,
        stock: size.stock || 0
      }
    })

    return {
      id,
      name: product.name || '',
      brand: product.brand || '',
      supplier: product.supplier || '',
      category: product.entity || '',
      rating: Number(product.nmReviewRating || product.reviewRating || product.rating) || 0,
      feedbacks: Number(product.nmFeedbacks || product.feedbacks) || 0,
      stock: Number(product.totalQuantity) || 0,
      sizes,
      imageURL,
      image,
      link: `${CATALOG_URL}/${id}/detail.aspx`
    }
  }

  /**
   * @param {Array<string|number>} ids
   * @return {string}
   */
  buildUrl(ids) {
    const nm = Array.isArray(ids) ? ids.join(';') : String(ids)
    const params = new URLSearchParams({ ...DEFAULT_PARAMS, nm })

    return `${CARD_URL}?${params.toString()}`
  }

  /**
   * @param {number} id
   * @return {string|null}
   */
  resolveBasketHost(id) {
    const vol = Math.floor(Number(id) / 1e5)
    const match = basketMap.find(r => vol >= r.from && vol <= r.to)

    if (!match) {
      console.error(`No basket mapping for vol = ${vol}`)
      return null
    }

    return `basket-${String(match.basket).padStart(2, '0')}.wbbasket.ru`
  }

  /**
   * @param {object} product
   * @return {string}
   */
  buildImageUrl(product) {
    const nm = Number(product.id)
    const vol = Math.floor(nm / 1e5)
    const part = Math.floor(nm / 1e3)
    const host = this.resolveBasketHost(nm)

    if (!nm || !vol || !part || !host) {
      return ''
    }

    return `https://${host}/vol${vol}/part${part}/${nm}/images/big/1.webp`
  }

  /**
   * @param {string} url
   * @return {Promise<string|null>}
   */
  async getImageStr(url) {
    if (!url) {
      return null
    }

    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })

      if (!res.ok) {
        console.warn(`[getImageStr] failed: ${url} (${res.status})`)
        return null
      }

      const arrayBuffer = await res.arrayBuffer()
      const buffer = /** @type {Buffer} */ Buffer.from(arrayBuffer)

      return `data:image/webp;base64,${buffer.toString('base64')}`
    } catch (e) {
      console.error(`[getImageStr] fetch error: ${url}`, e.message)
      return null
    }
  }

  /**
   * @param {ProductCard} card
   * @returns {Promise<void>}
   */
  async saveProduct(card) {
    const collection = this.db.collection('products')

    const update = {
      $set: {
        ...card,
        lastCheckedAt: new Date()
      }
    }

    await collection.updateOne(
      { id: card.id },
      update,
      { upsert: true }
    )

    console.log(`[mongo] product ${card.id} saved`)
  }

  /**
   * @param {TgBot} bot
   * @return {Promise<void>}
   */
  async checkPrices(bot) {
    try {
      const users = await this.db.collection('users').find({ subscriptions: { $ne: [] } }).toArray()
      const diffs = await this.getProductsDiffs(users)

      if (diffs.length === 0) {
        console.log('[WbApi] no price changes found')
        return
      }

      await this.applyProductDiffs(diffs)
      await this.notifySubscribers(bot, diffs, users)

      console.log('[WbApi] price check completed successfully')
    } catch (e) {
      console.error('[WbApi] checkPrices error:', e)
    }
  }

  /**
   * @param {User[]} users
   * @returns {Promise<Diff[]>}
   */
  async getProductsDiffs(users) {
    const subscribedIds = [
      ...new Set(users.flatMap(u => u.subscriptions.map(s => s.productId)))
    ]

    if (subscribedIds.length === 0) {
      console.log('[WbApi] no subscribed products, skipping check')
      return []
    }

    const threshold = new Date(Date.now() - this.threshold)
    const productsToCheck = await this.db.collection('products')
      .find({
        id: { $in: subscribedIds },
        lastCheckedAt: { $lt: threshold }
      })
      .limit(100)
      .toArray()

    if (productsToCheck.length === 0) {
      return []
    }

    const freshCards = await this.getProducts(productsToCheck.map(p => p.id))

    const dbById = new Map(productsToCheck.map(p => [p.id, p]))
    const diffs = []

    for (const card of freshCards) {
      const dbProduct = dbById.get(card.id)
      const { changes, historyEntries, sizes } = this.getDiffPrice(card, dbProduct)

      if (changes.length > 0) {
        diffs.push({ card, changes, historyEntries, sizes })
      }
    }

    return diffs
  }

  /**
   * @param {ProductCard} card
   * @param {object} dbProduct
   * @returns {{changes: Changes[], historyEntries: PriceHistoryEntry[], sizes: ProductSize[]}}
   */
  getDiffPrice(card, dbProduct) {
    const now = new Date()
    const dbSizes = Array.isArray(dbProduct?.sizes) ? dbProduct.sizes : []
    const dbByOption = new Map(dbSizes.map(s => [s.optionId, s]))

    const changes = []
    const historyEntries = []
    const sizes = []

    for (const size of card.sizes) {
      const prev = dbByOption.get(size.optionId)
      const prevPrice = prev?.currentPrice ?? size.currentPrice

      if (size.currentPrice !== prevPrice) {
        changes.push({
          optionId: size.optionId,
          name: size.name,
          prevPrice,
          currentPrice: size.currentPrice
        })

        historyEntries.push({
          productId: card.id,
          optionId: size.optionId,
          date: now,
          prevPrice,
          currentPrice: size.currentPrice
        })

        sizes.push({
          ...size,
          prevCurrentPrice: prevPrice,
          updateTime: now
        })
      } else {
        sizes.push({
          ...size,
          prevCurrentPrice: prev?.prevCurrentPrice ?? prevPrice,
          updateTime: prev?.updateTime ?? now
        })
      }
    }

    return {changes, historyEntries, sizes}
  }

  /**
   * @param {Diff[]} diffs
   * @return {Promise<void>}
   */
  async applyProductDiffs(diffs) {
    const productsCol = this.db.collection('products')
    const historyCol = this.db.collection('price_history')

    const now = new Date()
    const productUpdates = []
    const allHistoryEntries = []

    for (const { card, historyEntries, sizes } of diffs) {
      productUpdates.push({
        updateOne: {
          filter: { id: card.id },
          update: { $set: { sizes, lastCheckedAt: now } },
          upsert: true
        }
      })

      if (historyEntries.length > 0) {
        allHistoryEntries.push(...historyEntries)
      }
    }

    if (productUpdates.length > 0) {
      await productsCol.bulkWrite(productUpdates, { ordered: false })
    }

    if (allHistoryEntries.length > 0) {
      await historyCol.insertMany(allHistoryEntries)
    }

    console.log(`[WbApi] updated ${productUpdates.length} products, inserted ${allHistoryEntries.length} history entries`)
  }

  /**
   * @param {TgBot} bot
   * @param {Diff[]} diffs
   * @param {User[]} users
   * @return {Promise<void>}
   */
  async notifySubscribers(bot, diffs, users) {
    const notifications = []

    for (const { card, changes } of diffs) {
      const changedOptionIds = changes.map(c => c.optionId)
      const affectedUsers = users.filter(u =>
        u.subscriptions.some(
          s => s.productId === card.id && changedOptionIds.includes(s.optionId)
        )
      )

      for (const user of affectedUsers) {
        const relevantChanges = changes.filter(c =>
          user.subscriptions.some(
            s => s.productId === card.id && s.optionId === c.optionId
          )
        )
        notifications.push({ user, card, relevantChanges })
      }
    }

    for (let i = 0; i < notifications.length; i += this.notifiLimit) {
      const batch = notifications.slice(i, i + this.notifiLimit)

      await Promise.all(batch.map(({ user, card, relevantChanges }) =>
        bot.notifyPriceChange(user, card, relevantChanges)
      ))
    }

    console.log(`[WbApi] notified ${notifications.length} users`)
  }

  /**
   * @param {TgBot} bot
   */
  async startPriceWatcher(bot) {
    if (this.priceWatcherId) {
      console.warn('[WbApi] price watcher already running, skipping start')
      return
    }

    console.log(`[WbApi] starting price watcher (${this.watchInterval / 1000}s interval)`)

    this.priceWatcherId = setInterval(() => this.checkPrices(bot), this.watchInterval)
  }

  /**
   * Stop periodic price checker
   */
  stopPriceWatcher() {
    if (this.priceWatcherId) {
      clearInterval(this.priceWatcherId)
      this.priceWatcherId = null
      console.log('[WbApi] price watcher stopped')
    }
  }
}
