import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { Deck } from './demo/Deck';
import './styles.css';

const wantsDeck =
  window.location.pathname === '/demo' ||
  new URLSearchParams(window.location.search).get('demo') === '1';

createRoot(document.getElementById('root')!).render(
  <StrictMode>{wantsDeck ? <Deck /> : <App />}</StrictMode>,
);
