import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import { db } from "./connection.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = resolve(__dirname, "../../drizzle")

export async function runMigrations() {
  console.log(`Running database migrations from ${migrationsFolder}...`)
  await migrate(db, { migrationsFolder })
  console.log("Migrations complete.")
}

// Run directly via: bun run src/db/migrate.ts
