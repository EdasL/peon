import { useTeams } from "@/hooks/use-teams"
import { TeamCard } from "@/components/TeamCard"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"

interface TeamsPageProps {
  onSelectTeam: (name: string) => void
}

export function TeamsPage({ onSelectTeam }: TeamsPageProps) {
  const { teams, loading, error } = useTeams()

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-6 py-12">
        <div className="mb-10 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Teams</h1>
            <p className="mt-1 text-muted-foreground">
              Manage your agent teams and their Kanban boards
            </p>
          </div>
          <Button disabled variant="outline">
            <Plus className="size-4" />
            New Team
          </Button>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-24">
            <div className="text-sm text-muted-foreground">
              Loading teams...
            </div>
          </div>
        )}

        {error && !loading && (
          <div className="flex flex-col items-center justify-center gap-4 py-24">
            <p className="text-sm text-muted-foreground">{error}</p>
            <p className="text-xs text-muted-foreground/60">
              Make sure the backend is running on port 3001
            </p>
          </div>
        )}

        {!loading && !error && teams.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-24">
            <p className="text-sm text-muted-foreground">No teams found</p>
            <p className="text-xs text-muted-foreground/60">
              Create a Claude Code team to get started
            </p>
          </div>
        )}

        {!loading && !error && teams.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {teams.map((team) => (
              <TeamCard
                key={team.name}
                team={team}
                onClick={() => onSelectTeam(team.name)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
