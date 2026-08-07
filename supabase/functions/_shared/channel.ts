// Roteamento de canal. O user_id carrega de onde a mensagem veio:
//   - "tg:<chatId>"  → Telegram
//   - qualquer outro  → WhatsApp (remoteJid)
//
// Usado por quem entrega de volta (cron, tools que mandam arquivo) pra escolher
// o sender certo sem hardcode de canal.

export type Channel = "whatsapp" | "telegram";

export function channelFromUserId(userId: string): Channel {
  return userId.startsWith("tg:") ? "telegram" : "whatsapp";
}

/** Extrai o chat_id do Telegram de um user_id "tg:<chatId>". */
export function telegramChatId(userId: string): string {
  return userId.replace(/^tg:/, "");
}
