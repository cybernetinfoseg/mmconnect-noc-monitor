import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'

// Set global locale to Portugal
if (typeof window !== 'undefined') {
  document.documentElement.lang = 'pt-PT';

  // Force light mode regardless of system preference
  document.documentElement.classList.remove('dark');
  document.documentElement.style.colorScheme = 'light';
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)