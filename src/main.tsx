import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/inter'
import App from './App'
import StudentApp from './StudentApp'
import './styles.css'
import './fitness.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {window.location.pathname.startsWith('/aluno') ? <StudentApp /> : <App />}
  </React.StrictMode>,
)
