/**
 * @typedef {typeof import('./ui.mjs')} UiModule
 */

/**
 * @typedef {import('telegraf').Telegraf<Context>} Bot
 */

/**
 * @typedef {object} CacheEntry
 * @property {User} data
 * @property {number} ts
 */

// ----- CONTEXT ----- //

/**
 * @typedef {import('telegraf/types').Message} BaseTgMsg
 */

/**
 * @typedef {BaseTgMsg & {
 *   text?: string
 * }} TgMsg
 */

/**
 * @typedef {object} TgUpdate
 * @property {TgMsg} [message]
 */

/**
 * @typedef {import('telegraf/types').User & {
 *   id: number
 *   username?: string
 *   first_name?: string
 *   last_name?: string
 * }} TelegramUserInput
 */

/**
 * @typedef {import('telegraf').Context & {
 *   from?: TelegramUserInput
 *   update?: TgUpdate
 *   message?: TgMsg
 *   match?: RegExpMatchArray
 * }} Context
 */

// ----- USER ----- //

/**
 * @typedef {object} User
 * @property {number} _id userId
 * @property {string} [username]
 * @property {string} [firstName]
 * @property {string} [lastName]
 * @property {UserSubscription[]} subscriptions
 * @property {Date} createdAt
 * @property {Date} lastActiveAt
 */

/**
 * @typedef {object} UserSubscription
 * @property {number} productId
 * @property {number} optionId
 */

/**
 * @typedef {Object} UserMessages
 * @property {number|null} menu
 * @property {number[]} temp
 * @property {Map<number, number>} products - Map of productId → messageId
 * @property {number} lastActive
 */

// ----- PRODUCT ----- //

/**
 * @typedef {object} ProductCard
 * @property {number} id
 * @property {string} name
 * @property {string} brand
 * @property {string} supplier
 * @property {string} category
 * @property {number} rating
 * @property {number} feedbacks
 * @property {number} stock
 * @property {string} imageURL
 * @property {string|null} image
 * @property {string} link
 * @property {ProductSize[]} sizes
 * @property {Date} [lastCheckedAt]
 */

/**
 * @typedef {object} ProductSize
 * @property {string} name
 * @property {string} origName
 * @property {number|null} optionId
 * @property {number} stock
 * @property {number} originalPrice
 * @property {number} currentPrice
 * @property {number} walletPrice
 * @property {number} [prevCurrentPrice]
 * @property {Date} [updateTime]
 */

/**
 * @typedef {object} PriceHistoryEntry
 * @property {number} productId
 * @property {number|null} optionId
 * @property {Date} date
 * @property {number} prevPrice
 * @property {number} currentPrice
 * @property {string} [dest]
 */

/**
 * @typedef {object} Changes
 * @property {number} optionId
 * @property {string} name
 * @property {number} prevPrice
 * @property {number} currentPrice
 */

/**
 * @typedef {object} Diff
 * @property {ProductCard} card
 * @property {Changes[]} changes
 * @property {PriceHistoryEntry[]} historyEntries
 * @property {ProductSize[]} sizes
 */

/**
 * @typedef {object} ProductCardMessageOptions
 * @property {string} caption
 * @property {'Markdown'|'MarkdownV2'|'HTML'} parse_mode
 * @property {{ inline_keyboard: { text: string, callback_data: string }[][] }} reply_markup
 */

// ----- RAW PRODUCT ----- //

/**
 * @typedef {object} RawPrice
 * @property {number} [basic]
 * @property {number} [product]
 * @property {number} [logistics]
 * @property {number} [return]
 */

/**
 * @typedef {object} RawSize
 * @property {string} [name]
 * @property {string} [origName]
 * @property {number} [optionId]
 * @property {RawPrice} [price]
 * @property {number} [stock]
 */

/**
 * @typedef {object} RawProduct
 * @property {number|string} id
 * @property {string} [name]
 * @property {string} [brand]
 * @property {string} [supplier]
 * @property {string} [entity]
 * @property {RawSize[]} [sizes]
 * @property {number|string} [nmReviewRating]
 * @property {number|string} [reviewRating]
 * @property {number|string} [rating]
 * @property {number|string} [nmFeedbacks]
 * @property {number|string} [feedbacks]
 * @property {number|string} [totalQuantity]
 */
