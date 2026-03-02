import { migrate } from "drizzle-orm/node-postgres/migrator"
import { db } from "./connection.js"

export async function runMigrations() {
  console.log("Running database migrations...")
  await migrate(db, { migrationsFolder: "./drizzle" })
  console.log("Migrations complete.")
}

// Run directly via: bun run src/db/migrate.ts
