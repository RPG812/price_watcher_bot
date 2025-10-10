import { WbApi } from './services/wbApi.mjs'
import { TgBot } from './bot/tgBot.mjs'
import process from 'node:process'

const api = new WbApi('mongodb://localhost:27017', 'wb')
await api.initDb()
await api.setupMongo()

const bot = new TgBot(api)
await bot.start()

await api.startPriceWatcher(bot)

process.on('SIGINT', async () => {
  console.log('Shutting down...')
  await api.stopPriceWatcher()
  await bot.stop('SIGINT')
  process.exit(0)
})

console.log('DONE')

// const products = await api.getProducts([173990240])
// console.log(products)
// const products = await api.getProducts([70213027, 412107807, 498748698, 390778713])

// for (const card of products) {
//   await api.saveProduct(card)
//   await api.getDiffPrice(card)
// }
