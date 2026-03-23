import { getWebhookInfo } from "./src/services/telegramService.js";
getWebhookInfo().then(console.log).catch(console.error);
