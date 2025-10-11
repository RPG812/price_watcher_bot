import { WbApi } from './services/wbApi.mjs'
import { TgBot } from './bot/tgBot.mjs'
import process from 'node:process'

console.log(`[Main] starting (pid=${process.pid})...`)

const api = new WbApi()

try {
  await api.initDb()
  await api.setupMongo()

  const bot = new TgBot(api)

  try {
    await bot.start()
  } catch (err) {
    console.error(`[FATAL] Telegram bot failed to start (pid=${process.pid}):`, err)
    process.exit(1)
  }

  await api.startPriceWatcher(bot)
  console.log(`[Main] app fully started (pid=${process.pid})`)

  let shuttingDown = false

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => shutdown(signal))
  }

  async function shutdown(signal) {
    if (shuttingDown) {
      return
    }

    shuttingDown = true
    console.log(`[Main] Received ${signal}, shutting down (pid=${process.pid})...`)

    try {
      await api.stopPriceWatcher()
      await bot.stop(signal)
      console.log(`[Main] graceful shutdown complete (pid=${process.pid})`)
    } catch (err) {
      console.error(`[Main] Shutdown error (pid=${process.pid}):`, err)
    } finally {
      process.exit(0)
    }
  }
} catch (err) {
  console.error(`[FATAL] Unexpected startup error (pid=${process.pid}):`, err)
  process.exit(1)
}
