import { WbApi } from './services/wbApi.mjs'
import { TgBot } from './bot/tgBot.mjs'

const api = new WbApi('mongodb://localhost:27017', 'wb')

await api.initDb()
await api.setupMongo()


// const products = await api.getProducts([70213027, 412107807, 498748698, 390778713])
//
// for (const card of products) {
//   await api.saveProduct(card)
//   await api.updatePrice(card)
// }

const bot = new TgBot(api)
bot.start().catch((e) => console.error(e))

await api.startPriceWatcher(bot)

console.log('DONE')
