// Roteamento de canal. O user_id carrega de onde a mensagem veio:
//   - "tg:<chatId>"        → Telegram
//   - "ms:<conversationId>" → Teams
//   - qualquer outro        → WhatsApp (remoteJid)
//
// Usado por quem entrega de volta (cron, tools que mandam arquivo) pra escolher
// o sender certo sem hardcode de canal.

export type Channel = "whatsapp" | "telegram" | "teams";

export function channelFromUserId(userId: string): Channel {
  if (userId.startsWith("tg:")) return "telegram";
  if (userId.startsWith("ms:")) return "teams";
  return "whatsapp";
}

/** Extrai o chat_id do Telegram de um user_id "tg:<chatId>". */
export function telegramChatId(userId: string): string {
  return userId.replace(/^tg:/, "");
}

/** Extrai o conversationId do Teams de um user_id "ms:<conversationId>". */
export function teamsConversationId(userId: string): string {
  return userId.replace(/^ms:/, "");
}
