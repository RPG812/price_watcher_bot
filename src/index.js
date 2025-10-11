import { WbApi } from './services/wbApi.mjs'
import { TgBot } from './bot/tgBot.mjs'
import process from 'node:process'

const api = new WbApi('mongodb://localhost:27017', 'wb')

try {
  await api.initDb()
  await api.setupMongo()

  const bot = new TgBot(api)

  try {
    await bot.start()
  } catch (err) {
    console.error('[FATAL] Telegram bot failed to start:', err)
    process.exit(1)
  }

  await api.startPriceWatcher(bot)

  let shuttingDown = false

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => shutdown(signal))
  }

  async function shutdown(signal) {
    if (shuttingDown) {
      return
    }

    shuttingDown = true
    console.log(`Received ${signal}, shutting down...`)

    try {
      await api.stopPriceWatcher()
      await bot.stop(signal)
    } catch (err) {
      console.error('Shutdown error:', err)
    } finally {
      process.exit(0)
    }
  }
} catch (err) {
  console.error('[FATAL] Unexpected startup error:', err)
  process.exit(1)
}

