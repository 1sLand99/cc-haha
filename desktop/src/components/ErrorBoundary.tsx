import React from 'react'
import { CircleAlert } from 'lucide-react'
import { t, type TranslationKey } from '../i18n'
import { reportReactError } from '../lib/diagnosticsCapture'
import { DoctorPanel } from './doctor/DoctorPanel'
import { Button } from './ui/button'
import { StartupSurface } from './ui/custom/startup-surface'

type Props = {
  children: React.ReactNode
}

type State = {
  hasError: boolean
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: unknown, errorInfo: React.ErrorInfo) {
    void reportReactError(error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return <ErrorBoundaryFallback />
    }

    return this.props.children
  }
}

type DiagnosticsState = {
  hasError: boolean
}

class DiagnosticsFallbackBoundary extends React.Component<
  { children: React.ReactNode },
  DiagnosticsState
> {
  state: DiagnosticsState = { hasError: false }

  static getDerivedStateFromError(): DiagnosticsState {
    return { hasError: true }
  }

  componentDidCatch(error: unknown, errorInfo: React.ErrorInfo) {
    void reportReactError(error, errorInfo)
  }

  render() {
    return this.state.hasError ? null : this.props.children
  }
}

function safeTranslate(key: TranslationKey, fallback: string) {
  try {
    return t(key)
  } catch {
    return fallback
  }
}

function ErrorBoundaryFallback() {
  const title = safeTranslate('errorBoundary.title', 'Something went wrong.')
  const description = safeTranslate(
    'errorBoundary.description',
    'The error was recorded in Diagnostics.',
  )
  const retry = safeTranslate('common.retry', 'Retry')

  return (
    <StartupSurface
      title={title}
      description={description}
      icon={<CircleAlert aria-hidden="true" />}
      actions={(
        <Button
          autoFocus
          type="button"
          variant="secondary"
          onClick={() => window.location.reload()}
        >
          {retry}
        </Button>
      )}
    >
      <DiagnosticsFallbackBoundary>
        <div className="text-left">
          <DoctorPanel compact />
        </div>
      </DiagnosticsFallbackBoundary>
    </StartupSurface>
  )
}
