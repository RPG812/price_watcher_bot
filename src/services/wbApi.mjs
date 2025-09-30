import { Buffer } from 'node:buffer'
import { MongoClient } from 'mongodb'
import basketMap from './basketMap.mjs'

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
 * @typedef {object} PriceEntry
 * @property {Date} date
 * @property {number} priceCurrent
 * @property {number} priceOriginal
 * @property {string} dest
 */

/**
 * @typedef {object} ProductCard
 * @property {number} id
 * @property {string} name
 * @property {string} brand
 * @property {string} supplier
 * @property {string} category
 * @property {number} priceCurrent
 * @property {number} priceOriginal
 * @property {number} rating
 * @property {number} feedbacks
 * @property {number} stock
 * @property {string} imageURL
 * @property {string|null} image
 * @property {string} link
 * @property {PriceEntry[]} [history]
 */

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
    this.watchInterval = 60 * 1000
    this.threshold = 60 * 1000
    // this.threshold = 30 * 60 * 1000
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
          { key: { brand: 1 }, name: 'brand_1' },
          { key: { supplier: 1 }, name: 'supplier_1' }
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

      const data = await res.json()

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
   * @param {object} product
   * @returns {Promise<ProductCard>}
   */
  async getCard(product) {
    const id = Number(product.id)
    const imageURL = this.buildImageUrl(product)

    const existing = await this.db.collection('products').findOne(
      { _id: id },
      { projection: { image: 1 } }
    )

    let image = existing?.image || null

    if (!image) {
      image = await this.getImageStr(imageURL)
    }

    const size = product.sizes?.[0]?.price || {}
    const priceOriginal = size.basic ? size.basic / 100 : 0
    const priceCurrent = size.product ? size.product / 100 : 0

    return {
      id,
      name: product.name || '',
      brand: product.brand || '',
      supplier: product.supplier || '',
      category: product.entity || '',
      priceCurrent,
      priceOriginal,
      rating: Number(product.nmReviewRating || product.rating) || 0,
      feedbacks: Number(product.nmFeedbacks || product.feedbacks) || 0,
      stock: Number(product.totalQuantity) || 0,
      imageURL,
      image,
      link: `https://www.wildberries.ru/catalog/${id}/detail.aspx`
    }
  }



  /**
   * @param {Array<string|number>} ids
   * @return {string}
   */
  buildUrl(ids) {
    const nm = Array.isArray(ids) ? ids.join(';') : String(ids)
    const params = new URLSearchParams({ ...DEFAULT_PARAMS, nm })

    return `https://u-card.wb.ru/cards/v4/list?${params.toString()}`
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
      const buffer = Buffer.from(arrayBuffer)

      return `data:image/webp;base64,${buffer.toString('base64')}`
    } catch (e) {
      console.error(`[getImageStr] fetch error: ${url}`, e.message)
      return null
    }
  }

  /**
   * Save or update product in DB
   * @param {ProductCard} card
   * @returns {Promise<void>}
   */
  async saveProduct(card) {
    const collection = this.db.collection('products')

    const update = {
      $set: {
        name: card.name,
        brand: card.brand,
        supplier: card.supplier,
        link: card.link,
        imageURL: card.imageURL,
        image: card.image,
        category: card.category,
        stock: card.stock,
        rating: card.rating,
        feedbacks: card.feedbacks,
        lastCheckedAt: new Date()
      },
      $setOnInsert: {
        history: [{
          date: new Date(),
          priceCurrent: card.priceCurrent,
          priceOriginal: card.priceOriginal,
          dest: DEFAULT_PARAMS.dest
        }]
      }
    }

    await collection.updateOne(
      { _id: card.id },
      update,
      { upsert: true }
    )

    console.log(`[mongo] product ${card.id} saved`)
  }


  /**
   * @param {ProductCard} card
   * @returns {Promise<boolean>}
   */
  async checkPriceChange(card) {
    const collection = this.db.collection('products')
    const product = await collection.findOne({ _id: card.id }, { projection: { history: { $slice: -1 } } })

    if (!product || !product.history || product.history.length === 0) {
      return true
    }

    const last = product.history[0]

    return last.priceCurrent !== card.priceCurrent
  }

  /**
   * @param {ProductCard} card
   * @returns {Promise<void>}
   */
  async updatePrice(card) {
    const hasChanged = await this.checkPriceChange(card)

    if (!hasChanged) {
      return
    }

    const collection = this.db.collection('products')
    const entry = {
      date: new Date(),
      priceCurrent: card.priceCurrent,
      priceOriginal: card.priceOriginal,
      dest: DEFAULT_PARAMS.dest // TODO
    }

    await collection.updateOne(
      { _id: card.id },
      { $push: { history: entry } }
    )

    console.log(`[mongo] price updated for ${card.name}: ${entry.priceCurrent}`)
  }

  /**
   * Periodic price checker
   * @param {import('./tgBot.mjs').TgBot} bot
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

  /**
   * Check all products that need update
   * @param {import('./tgBot.mjs').TgBot} bot
   */
  async checkPrices(bot) {
    try {
      const usersCol = this.db.collection('users')
      const productsCol = this.db.collection('products')

      const users = await usersCol.find({ subscriptions: { $exists: true, $ne: [] } }).toArray()
      const subscribedIds = [...new Set(users.flatMap(u => u.subscriptions))]

      if (subscribedIds.length === 0) {
        console.log('[WbApi] no subscribed products, skipping check')
        return
      }

      const threshold = new Date(Date.now() - this.threshold)

      const productsToCheck = await productsCol
        .find({
          _id: { $in: subscribedIds },
          lastCheckedAt: { $lt: threshold }
        })
        .limit(100)
        .toArray()

      if (productsToCheck.length === 0) {
        return
      }

      console.log(`[WbApi] checking ${productsToCheck.length} products`)

      const ids = productsToCheck.map(p => p._id)
      const products = await this.getProducts(ids)

      for (const card of products) {
        const hasChanged = await this.checkPriceChange(card)

        await this.updatePrice(card)

        await productsCol.updateOne(
          { _id: card.id },
          { $set: { lastCheckedAt: new Date() } }
        )

        if (hasChanged) {
          const affectedUsers = users.filter(u => u.subscriptions.includes(card.id))

          for (const user of affectedUsers) {
            await bot.notifyPriceChange(user, card)
          }
        }
      }
    } catch (e) {
      console.error('[WbApi] checkPrices error:', e.message)
    }
  }
}
