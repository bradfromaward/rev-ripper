import { useState } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from './assets/vite.svg'
import './App.css'

function App() {
  const [count, setCount] = useState(0)

  return (
    <div className="app">
      <header className="header">
        <div className="logos" aria-hidden="true">
          <img src={viteLogo} alt="" className="logo logo--vite" />
          <span className="logos__plus">+</span>
          <img src={reactLogo} alt="" className="logo logo--react" />
        </div>
        <h1 className="title">Rev Ripper</h1>
        <p className="lede">
          Vite + React. Edit <code>src/App.jsx</code> and save — HMR updates
          instantly.
        </p>
        <button
          type="button"
          className="button"
          onClick={() => setCount((c) => c + 1)}
        >
          Count is {count}
        </button>
      </header>
    </div>
  )
}

export default App
