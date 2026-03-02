import { useState } from "react"
import { TeamsPage } from "@/pages/TeamsPage"
import { Board } from "@/components/board/Board"

export default function App() {
  const [activeTeam, setActiveTeam] = useState<string | null>(null)

  if (activeTeam) {
    return <Board teamName={activeTeam} onBack={() => setActiveTeam(null)} />
  }

  return <TeamsPage onSelectTeam={setActiveTeam} />
}
