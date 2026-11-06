import { setupSandboxStorage } from './storage'
import { sandboxEnvironment } from './configuration'

sandboxEnvironment()
  .then(setupSandboxStorage)
  .then(() => {
    console.log('Local sandbox database/schema ready. Runtime data was not imported.')
  })
  .catch(() => {
    console.error(
      'Sandbox setup failed; check local service availability and SANDBOX_DATABASE_URL.',
    )
    process.exitCode = 1
  })
