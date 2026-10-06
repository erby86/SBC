import './zod-config.js'; // first: before any module builds or parses a schema
// body: Noto Sans Thai (variable weight); display (brand, numbers, headings): Chakra Petch
import '@fontsource-variable/noto-sans-thai/index.css';
import '@fontsource/chakra-petch/thai-500.css';
import '@fontsource/chakra-petch/thai-600.css';
import '@fontsource/chakra-petch/latin-500.css';
import '@fontsource/chakra-petch/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@sbc-noc/ui/tokens.css';
import './shell/shell.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App.js';
import { applyTheme, savedTheme } from './shell/theme.js';

applyTheme(savedTheme()); // before the first paint, so a saved theme does not flash

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

const queries = new QueryClient({
  defaultOptions: { queries: { retry: 2, refetchOnWindowFocus: false } },
});

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queries}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
