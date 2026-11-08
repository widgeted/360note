import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource-variable/inter';
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/editor.css';
import './styles/pages.css';
import './styles/landing.css';
import './styles/responsive.css';
import App from './App';
import { initializeTheme } from './lib/theme';
import { getLocale } from './lib/i18n';

initializeTheme();

const chinese = getLocale() === 'zh-CN';
document.title = chinese ? '360笔记 — 把想法留下，把知识连起来' : '360note — Keep ideas, connect knowledge';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
