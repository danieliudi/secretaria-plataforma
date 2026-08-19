// Decide se a resposta desta mensagem deve sair em áudio — mesma regra pros
// 3 canais (WhatsApp, Telegram; Teams ainda não recebe áudio, ver
// teams/index.ts). Duas condições independentes, qualquer uma basta:
//   - espelha: a pessoa mandou áudio, então ela responde em áudio.
//   - tenant.resposta_audio_sempre: toggle do wizard, força sempre áudio
//     mesmo quando a pessoa escreveu em texto (bom pra quem tá dirigindo ou
//     caminhando e prefere sempre ouvir, não só quando ela mesma falou).
export function deveResponderEmAudio(entradaEraAudio: boolean, respostaAudioSempre: boolean): boolean {
  return entradaEraAudio || respostaAudioSempre;
}
