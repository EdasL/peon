import { useNavigate, useLocation } from "react-router-dom"
import { useAuth } from "@/hooks/use-auth"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu"
import { LogOut, Settings, LayoutDashboard } from "lucide-react"
import { cn } from "@/lib/utils"

export function AppHeader() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const initials = user?.name
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() ?? "?"

  const isActive = (path: string) => location.pathname === path

  return (
    <header className="border-b px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-6">
        <button
          onClick={() => navigate("/dashboard")}
          className="text-lg font-semibold hover:opacity-80 transition-opacity"
        >
          peon
        </button>

        <nav className="flex items-center gap-1">
          <button
            onClick={() => navigate("/dashboard")}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm text-sm transition-colors",
              isActive("/dashboard")
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
          >
            <LayoutDashboard className="h-3.5 w-3.5" />
            Dashboard
          </button>
          <button
            onClick={() => navigate("/settings")}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm text-sm transition-colors",
              isActive("/settings")
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
          >
            <Settings className="h-3.5 w-3.5" />
            Settings
          </button>
        </nav>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Avatar size="sm">
              {user?.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.name} />}
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuLabel className="font-normal">
            <div className="text-sm font-medium">{user?.name}</div>
            <div className="text-xs text-muted-foreground">{user?.email}</div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => navigate("/settings")}>
            <Settings />
            Settings
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={logout}>
            <LogOut />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )
}
