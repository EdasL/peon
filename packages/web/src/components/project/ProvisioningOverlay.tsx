import { useEffect, useState, useRef } from "react"
import { Loader2, Check, AlertCircle, Server, FolderCog, Users, Rocket } from "lucide-react"
import { Button } from "@/components/ui/button"

interface ProvisioningStep {
  label: string
  icon: React.ReactNode
}

const STEPS: ProvisioningStep[] = [
  { label: "Provisioning your private environment", icon: <Server className="h-4 w-4" /> },
  { label: "Configuring workspace", icon: <FolderCog className="h-4 w-4" /> },
  { label: "Setting up team agents", icon: <Users className="h-4 w-4" /> },
  { label: "Ready to go!", icon: <Rocket className="h-4 w-4" /> },
]

const STEP_DELAYS = [3000, 6000, 0] // ms before auto-advancing to steps 1, 2, 3 (3 is SSE-driven)

type Status = "creating" | "running" | "error"

export function ProvisioningOverlay({
  projectName,
  status,
  onReady,
  onBack,
}: {
  projectName: string
  status: Status
  onReady: () => void
  onBack: () => void
}) {
  const [activeStep, setActiveStep] = useState(0)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    // Auto-advance through the first few steps on timers
    let cumulative = 0
    for (let i = 0; i < STEP_DELAYS.length; i++) {
      const delay = STEP_DELAYS[i]
      if (delay === 0) break
      cumulative += delay
      const targetStep = i + 1
      const timer = setTimeout(() => {
        setActiveStep((prev) => Math.max(prev, targetStep))
      }, cumulative)
      timersRef.current.push(timer)
    }
    return () => timersRef.current.forEach(clearTimeout)
  }, [])

  useEffect(() => {
    if (status === "running") {
      setActiveStep(STEPS.length - 1)
      const timer = setTimeout(onReady, 1200)
      return () => clearTimeout(timer)
    }
  }, [status, onReady])

  const isError = status === "error"

  return (
    <div className="h-screen flex flex-col items-center justify-center bg-background">
      <div className="w-full max-w-md px-6">
        <div className="text-center mb-10">
          <h1 className="text-xl font-semibold mb-1">Setting up {projectName}</h1>
          <p className="text-sm text-muted-foreground">
            {isError
              ? "Something went wrong during setup"
              : "This usually takes 15–30 seconds"}
          </p>
        </div>

        <div className="space-y-4">
          {STEPS.map((step, i) => {
            const isActive = i === activeStep && !isError
            const isComplete = i < activeStep || (i === STEPS.length - 1 && status === "running")
            const isPending = i > activeStep

            return (
              <div
                key={i}
                className={`flex items-center gap-3 rounded-lg border px-4 py-3 transition-all duration-500 ${
                  isActive
                    ? "border-primary/50 bg-primary/5"
                    : isComplete
                    ? "border-border bg-muted/30"
                    : "border-transparent opacity-40"
                }`}
              >
                <div className="flex-shrink-0">
                  {isComplete ? (
                    <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center">
                      <Check className="h-3.5 w-3.5 text-primary" />
                    </div>
                  ) : isActive ? (
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  ) : (
                    <div className="h-6 w-6 rounded-full border border-border flex items-center justify-center text-muted-foreground">
                      {step.icon}
                    </div>
                  )}
                </div>
                <span
                  className={`text-sm font-medium ${
                    isActive
                      ? "text-foreground"
                      : isComplete
                      ? "text-muted-foreground"
                      : "text-muted-foreground/60"
                  }`}
                >
                  {step.label}
                  {isActive && <span className="animate-pulse">...</span>}
                </span>
              </div>
            )
          })}
        </div>

        {isError && (
          <div className="mt-6 rounded-lg border border-destructive/50 bg-destructive/5 p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-destructive">Setup failed</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Check that your API key is valid and try again.
                </p>
                <Button variant="outline" size="sm" className="mt-3" onClick={onBack}>
                  Back to dashboard
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
