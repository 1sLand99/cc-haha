import type { FormEvent } from 'react'
import { KeyRound } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { saveAndVerifyH5Connection } from '../../lib/desktopRuntime'
import { Alert, AlertDescription } from '../ui/alert'
import { LoadingButton } from '../ui/custom/loading-button'
import { StartupSurface } from '../ui/custom/startup-surface'
import { Input } from '../ui/input'
import { Label } from '../ui/label'

type H5ConnectionViewProps = {
  initialServerUrl?: string | null
  error?: string | null
  onConnected: () => void
}

export function H5ConnectionView({
  initialServerUrl,
  error: initialError,
  onConnected,
}: H5ConnectionViewProps) {
  const [serverUrl, setServerUrl] = useState(initialServerUrl ?? '')
  const [token, setToken] = useState('')
  const [error, setError] = useState(initialError ?? '')
  const [submitting, setSubmitting] = useState(false)
  const errorRef = useRef<HTMLDivElement>(null)
  const serverUrlId = useId()
  const tokenId = useId()
  const errorId = useId()

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setError('')

    try {
      await saveAndVerifyH5Connection(serverUrl, token)
      onConnected()
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : 'Unable to connect to the H5 server.',
      )
      window.requestAnimationFrame(() => errorRef.current?.focus())
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <StartupSurface
      title="Connect to H5 Access"
      description="Enter the server URL and H5 access token from the desktop app."
      icon={<KeyRound aria-hidden="true" />}
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Label htmlFor={serverUrlId}>Server URL</Label>
          <Input
            id={serverUrlId}
            placeholder="https://chat.example.com"
            value={serverUrl}
            onChange={(event) => setServerUrl(event.target.value)}
            autoComplete="url"
            aria-describedby={error ? errorId : undefined}
            aria-invalid={error ? true : undefined}
            autoFocus={!initialServerUrl}
            disabled={submitting}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={tokenId}>H5 Token</Label>
          <Input
            id={tokenId}
            type="password"
            placeholder="h5_..."
            value={token}
            onChange={(event) => setToken(event.target.value)}
            autoComplete="current-password"
            aria-describedby={error ? errorId : undefined}
            aria-invalid={error ? true : undefined}
            autoFocus={Boolean(initialServerUrl)}
            disabled={submitting}
            required
          />
        </div>

        {error ? (
          <Alert
            ref={errorRef}
            id={errorId}
            variant="destructive"
            tabIndex={-1}
          >
            <AlertDescription className="text-[var(--color-error)]">
              {error}
            </AlertDescription>
          </Alert>
        ) : null}

        <LoadingButton type="submit" size="lg" className="w-full" loading={submitting}>
          Connect
        </LoadingButton>
      </form>
    </StartupSurface>
  )
}
