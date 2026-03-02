import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { App } from "@tinyhttp/app"
import { cors } from "@tinyhttp/cors"
import { json } from "milliparsec"
import { Low } from "lowdb"
import { JSONFile } from "lowdb/node"
import {
  getTeams,
  getTeamConfig,
  getTeamTasks,
  postTeamTask,
  patchTeamTask,
  deleteTeamTask,
} from "./middleware.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = 3001

// Set up lowdb for board config persistence
interface DbSchema {
  boards: Array<Record<string, unknown>>
}
const dbFile = join(__dirname, "db.json")
const adapter = new JSONFile<DbSchema>(dbFile)
const db = new Low(adapter, { boards: [] })
await db.read()

// Create app
const app = new App()

// CORS
app.use((req, res, next) => {
  cors({
    allowedHeaders: req.headers["access-control-request-headers"]
      ?.split(",")
      .map((h: string) => h.trim()),
  })(req, res, next)
}).options("*", cors())

// Body parser
app.use(json())

// Custom Claude Code routes
app.get("/api/teams", getTeams)
app.get("/api/teams/:name/config", getTeamConfig)
app.get("/api/teams/:name/tasks", getTeamTasks)
app.post("/api/teams/:name/tasks", postTeamTask)
app.patch("/api/teams/:name/tasks/:id", patchTeamTask)
app.delete("/api/teams/:name/tasks/:id", deleteTeamTask)

// Board config routes (lowdb-backed)
app.get("/api/boards", (_req, res) => {
  res.json(db.data.boards)
})

app.get("/api/boards/:id", (req, res) => {
  const board = db.data.boards.find((b) => b.id === req.params.id)
  if (!board) {
    res.status(404).json({ error: "Board not found" })
    return
  }
  res.json(board)
})

app.post("/api/boards", async (req, res) => {
  const board = {
    id: String(Date.now()),
    ...req.body,
  }
  db.data.boards.push(board)
  await db.write()
  res.status(201).json(board)
})

app.patch("/api/boards/:id", async (req, res) => {
  const idx = db.data.boards.findIndex((b) => b.id === req.params.id)
  if (idx === -1) {
    res.status(404).json({ error: "Board not found" })
    return
  }
  db.data.boards[idx] = { ...db.data.boards[idx], ...req.body }
  await db.write()
  res.json(db.data.boards[idx])
})

app.delete("/api/boards/:id", async (req, res) => {
  const idx = db.data.boards.findIndex((b) => b.id === req.params.id)
  if (idx === -1) {
    res.status(404).json({ error: "Board not found" })
    return
  }
  const [removed] = db.data.boards.splice(idx, 1)
  await db.write()
  res.json(removed)
})

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
  console.log(`Routes:`)
  console.log(`  GET    /api/teams`)
  console.log(`  GET    /api/teams/:name/config`)
  console.log(`  GET    /api/teams/:name/tasks`)
  console.log(`  POST   /api/teams/:name/tasks`)
  console.log(`  PATCH  /api/teams/:name/tasks/:id`)
  console.log(`  DELETE /api/teams/:name/tasks/:id`)
  console.log(`  CRUD   /api/boards`)
})
