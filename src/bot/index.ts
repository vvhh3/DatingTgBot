import { Telegraf } from "telegraf";
import type { Context } from "telegraf";
import { config } from "../config/index.js";
import { registerCommandHandlers } from "./handlers/commands.js";
import { registerCoreHandlers } from "./handlers/core.js";
import { registerMessageHandlers } from "./handlers/messages.js";
import { registerModerationActionHandlers } from "./handlers/moderation-actions.js";

const bot = new Telegraf<Context>(config.botToken);

// Порядок регистрации нужен в первую очередь для предсказуемой структуры приложения:
// сначала базовые обработчики, потом команды, затем сценарии модерации и обычные сообщения.
console.log("BOT STARTED");

registerCoreHandlers(bot);
registerCommandHandlers(bot);
registerModerationActionHandlers(bot);
registerMessageHandlers(bot);

bot.launch();

// Даём боту завершиться аккуратно, чтобы не обрывать polling посреди запроса.
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
