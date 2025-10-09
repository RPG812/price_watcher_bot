/**
 * Wraps ui-module with automatic message tracking via MessageStore
 * @param {UiModule} uiModule
 * @param {import('./messages.mjs').MessageStore} msgStore
 * @returns {UiModule} same shape as uiModule
 */
export function createTrackedUi(uiModule, msgStore) {
  return new Proxy(uiModule, {
    get(target, prop) {
      const original = target[prop]
      if (typeof original !== 'function') return original

      return async (...args) => {
        const ctx = args[0]
        const userId = ctx.from?.id
        const chatId = ctx.chat?.id
        if (!userId || !chatId) {
          return original(...args)
        }

        const isMenuCall = prop === 'sendMainMenu'
        const product = args[1]?.product

        // 1) pre-cleanup
        if (isMenuCall) {
          // Меню заменяем на новое, но не трогаем temp/баннеры
          await msgStore.deleteMenu(userId, chatId)
        } else {
          if (product?.id) {
            await msgStore.deleteProduct(userId, chatId, product.id)
          } else {
            await msgStore.deleteTemp(userId, chatId)
          }
        }

        // 2) send
        const result = await original(...args)

        // 3) track
        if (result && typeof result.message_id === 'number') {
          if (isMenuCall) {
            msgStore.trackMenu(userId, result.message_id)
          } else if (result.photo && product?.id) {
            msgStore.trackProduct(userId, product.id, result.message_id)
          } else {
            msgStore.trackTemp(userId, result.message_id)
          }
        }

        return result
      }
    }
  })
}

