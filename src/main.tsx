import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource-variable/noto-sans-jp'
import './i18n'
import './styles/base.css'
import './styles/welcome.css'
import './styles/import.css'
import './styles/editor.css'
import './styles/review.css'
import './styles/dialogs.css'
import './styles/responsive.css'
import { App } from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
