import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Desktops from './Desktops';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Desktops />
  </StrictMode>,
);
