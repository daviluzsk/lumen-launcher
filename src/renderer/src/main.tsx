import '@fontsource-variable/inter'
import './styles/base.css'
import './styles/glass.css'
import './styles/components.css'
import './styles/views.css'
import './styles/window.css'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { bootstrap, toast } from './lib/store'

async function start(): Promise<void> {
  // Outside Electron (plain browser preview) fall back to an in-memory mock backend.
  if (!window.prisma) await import('./lib/mock').then((m) => m.installMock())
  createRoot(document.getElementById('root')!).render(<App />)
  await bootstrap().catch((e: Error) => toast('error', 'Falha ao iniciar', e.message))
}

void start()
