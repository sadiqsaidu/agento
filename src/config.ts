import { z } from "zod";
import "dotenv/config";

const schema = z.object({
  SOLANA_RPC_URL: z
    .string()
    .url()
    .default("https://api.devnet.solana.com"),

  OPENROUTER_API_KEY: z.string().optional().default(""),
  JUPITER_API_KEY: z.string().optional().default(""),
  PORT: z.coerce.number().optional(),
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
  const data = result.data;
  // Render sets PORT, local dev uses REST_PORT
  if (data.PORT) data.REST_PORT = data.PORT;
  return data;
}