import { z } from "zod";
import "dotenv/config";

const schema = z.object({
  // Solana
  SOLANA_RPC_URL: z
    .string()
    .url()
    .default("https://api.devnet.solana.com"),

  // LLM (used by demo agent — optional for REST/MCP server)
  OPENROUTER_API_KEY: z.string().optional().default(""),

  // Jupiter API (free tier: 1 RPS — get key at https://portal.jup.ag)
  JUPITER_API_KEY: z.string().optional().default(""),

  // Server
  REST_PORT: z.coerce.number().default(3000),

  // Keystore
  KEYSTORE_DIR: z.string().default("./wallets"),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(): Config {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    console.error(`❌ Invalid configuration:\n${missing}`);
    process.exit(1);
  }
  return result.data;
}
