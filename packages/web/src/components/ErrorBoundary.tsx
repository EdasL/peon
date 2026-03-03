import { Component, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { AlertCircle } from "lucide-react"

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen flex flex-col items-center justify-center gap-4 p-8">
          <div className="flex items-center gap-3 text-destructive">
            <AlertCircle className="h-6 w-6" />
            <h2 className="text-lg font-semibold">Something went wrong</h2>
          </div>
          <p className="text-sm text-muted-foreground text-center max-w-md">
            An unexpected error occurred. Try refreshing the page.
          </p>
          {this.state.error && (
            <pre className="text-xs text-muted-foreground bg-muted rounded-md p-3 max-w-lg overflow-auto">
              {this.state.error.message}
            </pre>
          )}
          <Button
            variant="outline"
            onClick={() => {
              this.setState({ hasError: false, error: null })
              window.location.href = "/dashboard"
            }}
          >
            Back to dashboard
          </Button>
        </div>
      )
    }

    return this.props.children
  }
}
