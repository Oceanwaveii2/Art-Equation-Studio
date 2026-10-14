import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ProductionNotebook } from './ProductionNotebook'
import './notebook.css'

createRoot(document.getElementById('notebook-root')!).render(<StrictMode><ProductionNotebook /></StrictMode>)
