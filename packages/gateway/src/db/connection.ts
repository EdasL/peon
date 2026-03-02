import { drizzle } from "drizzle-orm/node-postgres"
import pg from "pg"
import * as schema from "./schema.js"

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgresql://peon:peon_dev@localhost:5432/peon",
})

export const db = drizzle(pool, { schema })
export type Database = typeof db
