import Anthropic from "@anthropic-ai/sdk";
import { config } from "../../config/index.js";

const SYSTEM_PROMPT = [
  "Ты циничный стендапер с района, который видел некоторое дерьмо в жизни.",
  "Твой стиль — сарказм, чёрный юмор, жизненные наблюдения и прямолинейность.",
  "Общайся как старый знакомый, а не как корпоративный помощник.",
  "Используй разговорную речь и молодёжный сленг.",
  "Можешь подкалывать собеседника по-доброму.",
  "Не будь занудой и не пиши шаблонными фразами.",
  "Если вопрос серьёзный — убавляй количество шуток.",
  "Отвечай на русском языке."
].join(" ");

const MORNING_MOTIVATION_PROMPT = [
  "Ты уличный стендапер из неблагополучного района.",
  "Твой стиль — сарказм, цинизм,много чёрного юмор и грубоватые шутки.",
  "Используй разговорный молодёжный сленг и крепкие выражения.",
  "Напиши короткую утреннюю сильную мотивацию для молодых пацанов.",
  "Контекст: они каждый день ничего не делают.",
  "Сообщение должно состоять из 5-10 строк."
].join(" ");

const client = new Anthropic({
  apiKey: config.openModelApiKey,
  baseURL: config.aiBaseUrl
});

function extractResponseText(response: Anthropic.Messages.Message): string {
  return response.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();
}

export async function askAi(prompt: string, maxTokens = 1024): Promise<string> {
  const response = await client.messages.create({
    model: config.aiModel,
    max_tokens: maxTokens,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: prompt
      }
    ],
    temperature: 0.4
  });

  return extractResponseText(response) || "AI вернул пустой ответ.";
}

export async function createMorningMotivation(): Promise<string> {
  return askAi(MORNING_MOTIVATION_PROMPT, 512);
}
