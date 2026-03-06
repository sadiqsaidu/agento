/**
 * Encrypted Keystore — Ethereum Web3 Secret Storage V3 adapted for Solana
 *
 * Each wallet is stored as a JSON file with the following structure:
 *   - KDF:    scrypt (N=2^18, r=8, p=1) → 32-byte derived key
 *   - Cipher: AES-256-GCM with random 12-byte IV
 *   - MAC:    Inherent in GCM's authentication tag
 *
 * Files are stored at: <KEYSTORE_DIR>/<wallet_id>.json
 */

import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

export interface KeystoreFile {
  version: 3;
  id: string;
  address: string; // Solana public key (base58)
  crypto: {
    cipher: "aes-256-gcm";
    cipherparams: { iv: string };
    ciphertext: string;
    authtag: string;
    kdf: "scrypt";
    kdfparams: {
      dklen: number;
      n: number;
      r: number;
      p: number;
      salt: string;
    };
  };
  created_at: string;
}

const KDF_PARAMS = {
  dklen: 32,
  n: 2 ** 18, 
  r: 8,
  p: 1,
} as const;

function deriveKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, KDF_PARAMS.dklen, {
    N: KDF_PARAMS.n,
    r: KDF_PARAMS.r,
    p: KDF_PARAMS.p,
    maxmem: 256 * KDF_PARAMS.n * KDF_PARAMS.r,
  });
}


function encrypt(secretKey: Uint8Array, password: string): KeystoreFile {
  const salt = randomBytes(32);
  const iv = randomBytes(12); 
  const derivedKey = deriveKey(password, salt);

  const cipher = createCipheriv("aes-256-gcm", derivedKey, iv);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(secretKey)), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const keypair = Keypair.fromSecretKey(secretKey);

  return {
    version: 3,
    id: generateId(),
    address: keypair.publicKey.toBase58(),
    crypto: {
      cipher: "aes-256-gcm",
      cipherparams: { iv: iv.toString("hex") },
      ciphertext: ciphertext.toString("hex"),
      authtag: authTag.toString("hex"),
      kdf: "scrypt",
      kdfparams: {
        ...KDF_PARAMS,
        salt: salt.toString("hex"),
      },
    },
    created_at: new Date().toISOString(),
  };
}

function decrypt(keystore: KeystoreFile, password: string): Keypair {
  const { kdfparams, cipherparams, ciphertext, authtag } = keystore.crypto;
  const salt = Buffer.from(kdfparams.salt, "hex");
  const iv = Buffer.from(cipherparams.iv, "hex");
  const derivedKey = deriveKey(password, salt);

  const decipher = createDecipheriv("aes-256-gcm", derivedKey, iv);
  decipher.setAuthTag(Buffer.from(authtag, "hex"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "hex")),
    decipher.final(),
  ]);

  return Keypair.fromSecretKey(new Uint8Array(decrypted));
}


function generateId(): string {
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 1
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}


export class Keystore {
  private dir: string;

  constructor(dir: string) {
    this.dir = dir;
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  create(password: string): { id: string; address: string } {
    const keypair = Keypair.generate();
    const keystore = encrypt(keypair.secretKey, password);
    const filePath = join(this.dir, `${keystore.id}.json`);
    writeFileSync(filePath, JSON.stringify(keystore, null, 2), "utf-8");
    return { id: keystore.id, address: keystore.address };
  }

  import(secretKeyBase58: string, password: string): { id: string; address: string } {
    const secretKey = bs58.decode(secretKeyBase58);
    const keystore = encrypt(secretKey, password);
    const filePath = join(this.dir, `${keystore.id}.json`);
    writeFileSync(filePath, JSON.stringify(keystore, null, 2), "utf-8");
    return { id: keystore.id, address: keystore.address };
  }

  unlock(id: string, password: string): Keypair {
    const keystore = this.read(id);
    return decrypt(keystore, password);
  }

  list(): Array<{ id: string; address: string; created_at: string }> {
    const files = readdirSync(this.dir).filter((f) => f.endsWith(".json"));
    return files.map((f) => {
      const ks: KeystoreFile = JSON.parse(readFileSync(join(this.dir, f), "utf-8"));
      return { id: ks.id, address: ks.address, created_at: ks.created_at };
    });
  }

  delete(id: string): void {
    const filePath = join(this.dir, `${id}.json`);
    if (!existsSync(filePath)) throw new Error(`Wallet ${id} not found`);
    unlinkSync(filePath);
  }

  export(id: string, password: string): string {
    const keypair = this.unlock(id, password);
    return bs58.encode(keypair.secretKey);
  }

  private read(id: string): KeystoreFile {
    const filePath = join(this.dir, `${id}.json`);
    if (!existsSync(filePath)) throw new Error(`Wallet ${id} not found`);
    return JSON.parse(readFileSync(filePath, "utf-8"));
  }
}
