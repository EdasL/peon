import { useEffect, useState, useRef } from "react"
import { Loader2, Check, AlertCircle, Server, FolderCog, Cpu, Bot, Rocket } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { Project } from "@/lib/api"

interface ProvisioningStep {
  key: string
  label: string
  icon: React.ReactNode
}

const STEPS: ProvisioningStep[] = [
  { key: "container", label: "Provisioning environment", icon: <Server className="h-4 w-4" /> },
  { key: "workspace", label: "Configuring workspace", icon: <FolderCog className="h-4 w-4" /> },
  { key: "engine", label: "Starting AI engine", icon: <Cpu className="h-4 w-4" /> },
  { key: "ready", label: "Connecting to agent", icon: <Bot className="h-4 w-4" /> },
  { key: "setup", label: "Setting up project", icon: <Rocket className="h-4 w-4" /> },
]

const STEP_INDEX: Record<string, number> = {}
STEPS.forEach((s, i) => { STEP_INDEX[s.key] = i })

const SKIP_TIMEOUT_MS = 120_000

export function ProvisioningOverlay({
  projectName,
  status,
  bootStep,
  onReady,
  onBack,
}: {
  projectName: string
  status: Project["status"]
  bootStep: string | null
  onReady: () => void
  onBack: () => void
}) {
  const [activeStep, setActiveStep] = useState(0)
  const [canSkip, setCanSkip] = useState(false)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  // Advance steps based on real boot progress events
  useEffect(() => {
    if (!bootStep) return
    const idx = STEP_INDEX[bootStep]
    if (idx !== undefined) {
      setActiveStep((prev) => Math.max(prev, idx))
    }
  }, [bootStep])

  // When status transitions to "initializing", advance to the setup step
  useEffect(() => {
    if (status === "initializing") {
      const setupIdx = STEP_INDEX["setup"]
      if (setupIdx !== undefined) {
        setActiveStep((prev) => Math.max(prev, setupIdx))
      }
    }
  }, [status])

  // Fallback: slowly advance step 0 after 8s if no boot_progress arrives
  useEffect(() => {
    const fallbackTimer = setTimeout(() => {
      setActiveStep((prev) => (prev === 0 ? 0 : prev))
    }, 8000)
    const skipTimer = setTimeout(() => setCanSkip(true), SKIP_TIMEOUT_MS)
    timersRef.current.push(fallbackTimer, skipTimer)
    return () => timersRef.current.forEach(clearTimeout)
  }, [])

  useEffect(() => {
    if (status === "running") {
      setActiveStep(STEPS.length)
      const timer = setTimeout(onReady, 1200)
      return () => clearTimeout(timer)
    }
    if (status === "stopped") {
      onReady()
    }
  }, [status, onReady])

  const isError = status === "error"
  const allComplete = status === "running"

  return (
    <div className="h-screen flex flex-col items-center justify-center bg-background">
      <div className="w-full max-w-md px-6">
        <div className="text-center mb-10">
          <h1 className="text-xl font-semibold mb-1">Setting up {projectName}</h1>
          <p className="text-sm text-muted-foreground">
            {isError
              ? "Something went wrong during setup"
              : status === "initializing"
              ? "Almost there — agent is getting ready"
              : "This usually takes 30\u201360 seconds"}
          </p>
        </div>

        <div className="space-y-4">
          {STEPS.map((step, i) => {
            const isActive = i === activeStep && !isError && !allComplete
            const isComplete = i < activeStep || allComplete

            return (
              <div
                key={step.key}
                className={`flex items-center gap-3 rounded-sm border px-4 py-3 transition-all duration-500 ${
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
          <div className="mt-6 rounded-sm border border-destructive/50 bg-destructive/5 p-4">
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

        {canSkip && !isError && (status === "creating" || status === "initializing") && (
          <div className="mt-6 text-center">
            <p className="text-xs text-muted-foreground mb-2">
              Taking longer than expected?
            </p>
            <Button variant="ghost" size="sm" onClick={onReady}>
              Continue to project
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
