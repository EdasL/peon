import { migrate } from "drizzle-orm/node-postgres/migrator"
import { db } from "./connection.js"

export async function runMigrations() {
  console.log("Running database migrations...")
  await migrate(db, { migrationsFolder: "./drizzle" })
  console.log("Migrations complete.")
}

// Allow running directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Migration failed:", err)
      process.exit(1)
    })
}
