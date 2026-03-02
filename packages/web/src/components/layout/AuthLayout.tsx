import { AppHeader } from "./AppHeader"

export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <AppHeader />
      {children}
    </div>
  )
}
