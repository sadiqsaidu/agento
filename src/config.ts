import { z } from "zod";
import "dotenv/config";

const schema = z.object({
  SOLANA_RPC_URL: z.string().url().default("https://api.devnet.solana.com"),
  JUPITER_API_KEY: z.string().optional().default(""),
  REST_PORT: z.coerce.number().default(3000),
  KEYSTORE_DIR: z.string().default("./wallets"),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(): Config {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues
      .map((i) => ` ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    console.error(`Invalid configuration:\n${missing}`);
    process.exit(1);
  }
  return result.data;
}