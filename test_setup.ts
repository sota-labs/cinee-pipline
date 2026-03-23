import { setupWebhook } from "./src/services/telegramService.js";
setupWebhook("https://de9c-101-96-127-140.ngrok-free.app/api/telegram/webhook").then(console.log).catch(console.error);
