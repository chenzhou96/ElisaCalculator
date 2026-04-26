import { AppStateProvider } from './context/AppStateContext'
import Shell from './components/layout/Shell'
import './App.css'

export default function App() {
  return (
    <AppStateProvider>
      <Shell />
    </AppStateProvider>
  )
}
