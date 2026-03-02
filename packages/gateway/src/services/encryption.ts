import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? "0".repeat(64)
const KEY_BUFFER = Buffer.from(ENCRYPTION_KEY, "hex")
const ALGORITHM = "aes-256-gcm"

export function encrypt(text: string): string {
  const iv = randomBytes(16)
  const cipher = createCipheriv(ALGORITHM, KEY_BUFFER, iv)
  let encrypted = cipher.update(text, "utf8", "hex")
  encrypted += cipher.final("hex")
  const authTag = cipher.getAuthTag().toString("hex")
  return `${iv.toString("hex")}:${authTag}:${encrypted}`
}

export function decrypt(data: string): string {
  const [ivHex, authTagHex, encrypted] = data.split(":")
  const decipher = createDecipheriv(ALGORITHM, KEY_BUFFER, Buffer.from(ivHex, "hex"))
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"))
  let decrypted = decipher.update(encrypted, "hex", "utf8")
  decrypted += decipher.final("utf8")
  return decrypted
}
