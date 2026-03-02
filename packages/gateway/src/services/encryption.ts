import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY
if (!ENCRYPTION_KEY || ENCRYPTION_KEY === "0".repeat(64)) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("ENCRYPTION_KEY must be set to a secure 32-byte hex value in production")
  }
  console.warn("[encryption] WARNING: Using insecure default key. Set ENCRYPTION_KEY for production.")
}
const KEY_BUFFER = Buffer.from(ENCRYPTION_KEY ?? "0".repeat(64), "hex")

export function encrypt(text: string): string {
  const iv = randomBytes(16)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cipher: any = createCipheriv("aes-256-gcm", KEY_BUFFER, iv)
  let encrypted: string = cipher.update(text, "utf8", "hex")
  encrypted += cipher.final("hex")
  const authTag: string = cipher.getAuthTag().toString("hex")
  return `${iv.toString("hex")}:${authTag}:${encrypted}`
}

export function decrypt(data: string): string {
  const parts = data.split(":")
  const ivHex = parts[0]!
  const authTagHex = parts[1]!
  const encrypted = parts[2]!
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const decipher: any = createDecipheriv("aes-256-gcm", KEY_BUFFER, Buffer.from(ivHex, "hex"))
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"))
  let decrypted: string = decipher.update(encrypted, "hex", "utf8")
  decrypted += decipher.final("utf8")
  return decrypted
}
