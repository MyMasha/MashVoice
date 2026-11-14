import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { installRustBridge } from './lib/rustBridge.js';
import './styles/index.css';

installRustBridge();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
