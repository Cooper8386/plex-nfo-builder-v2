import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router';
import { AuthGate } from './app/AuthGate.js';
import { ErrorBoundary } from './app/ErrorBoundary.js';
import { queryClient } from './app/query-client.js';
import { Shell } from './app/Shell.js';
import './design/styles.css';
import './app/shell.css';

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <AuthGate><BrowserRouter><Shell /></BrowserRouter></AuthGate>
    </QueryClientProvider>
  </ErrorBoundary>,
);
