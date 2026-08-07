import Anthropic from "npm:@anthropic-ai/sdk@0.40.1";

export function getAnthropicClient(): Anthropic {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");
  return new Anthropic({ apiKey: key });
}
