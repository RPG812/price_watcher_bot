/**
 * @typedef {object} User
 * @property {number} _id userId
 * @property {string} username
 * @property {string} firstName
 * @property {string} lastName
 * @property {{productId: number, optionId: number}[]} subscriptions
 * @property {Date} createdAt
 * @property {Date} lastActiveAt
 */

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
