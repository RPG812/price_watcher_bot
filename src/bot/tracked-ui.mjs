/**
 * Wraps UI module with automatic message tracking via MessageStore.
 * @param {typeof import('./ui.mjs')} uiModule
 * @param {import('./messages.mjs').MessageStore} msgStore
 * @returns {typeof uiModule}
 */
export function createTrackedUi(uiModule, msgStore) {
  return new Proxy(uiModule, {
    get(target, prop) {
      const original = target[prop]

      if (typeof original !== 'function' || typeof prop !== 'string' || !/^reply|send/.test(prop)) {
        return original
      }

      return async (params = {}) => {
        const meta = extractMeta(params)

        if (!meta.chatId) {
          return original(params)
        }

        const type = detectType(prop)

        await safeCleanup(msgStore, type, meta, prop)

        const result = await original(params)

        safeTrack(msgStore, result, type, meta, prop)

        return result
      }
    }
  })
}

// -------------------- Helpers -------------------- //

/**
 * Extracts identifiers (userId, chatId, productId) from params.
 * @param {object} params
 * @returns {{ userId: number|null, chatId: number|null, productId: number|null }}
 */
function extractMeta(params) {
  const { ctx, chatId, card, productId, product } = params

  let userId = null
  let resolvedChatId = null

  if (ctx) {
    userId = ctx.from?.id || chatId || null
    resolvedChatId = ctx.chat?.id || ctx.message?.chat?.id || chatId || null
  } else if (chatId) {
    userId = chatId
    resolvedChatId = chatId
  }

  const resolvedProductId = productId || product?.id || card?.productId || null

  return { userId, chatId: resolvedChatId, productId: resolvedProductId }
}


/**
 * Detects message category based on function name.
 * @param {string} prop
 * @returns {'menu' | 'product' | 'temp'}
 */
function detectType(prop) {
  if (prop.includes('MainMenu')) {
    return 'menu'
  }

  if (prop.includes('ProductCard')) {
    return 'product'
  }

  return 'temp'
}

/**
 * Safely cleans up old messages before sending a new one.
 * @param {MessageStore} msgStore
 * @param {'menu'|'product'|'temp'} type
 * @param {{ userId:number|null, chatId:number|null, productId:number|null }} meta
 * @param {string} prop
 */
async function safeCleanup(msgStore, type, meta, prop) {
  const { userId, chatId, productId } = meta

  try {
    switch (type) {
      case 'menu':
        await msgStore.deleteMenu(userId, chatId)

        break
      case 'product':
        if (productId) {
          await msgStore.deleteProduct(userId, chatId, productId)
        }

        break
      default:
        await msgStore.deleteTemp(userId, chatId)
    }
  } catch (err) {
    console.warn(`[TrackedUi] cleanup failed in ${prop}: ${err.message}`)
  }
}

/**
 * Safely tracks sent messages for later cleanup.
 * @param {MessageStore} msgStore
 * @param {any} result
 * @param {'menu'|'product'|'temp'} type
 * @param {{ userId:number|null, chatId:number|null, productId:number|null }} meta
 * @param {string} prop
 */
function safeTrack(msgStore, result, type, meta, prop) {
  const { userId, productId } = meta
  const messageId = result?.message_id

  if (!messageId) {
    return
  }

  try {
    switch (type) {
      case 'menu':
        msgStore.trackMenu(userId, messageId)

        break
      case 'product':
        if (productId) {
          msgStore.trackProduct(userId, productId, messageId)
        }

        break
      default:
        msgStore.trackTemp(userId, messageId)
    }
  } catch (err) {
    console.warn(`[TrackedUi] tracking failed in ${prop}: ${err.message}`)
  }
}
