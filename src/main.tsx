import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { I18nProvider } from '@/lib/i18n';
import { STANDALONE } from '@/lib/supabase';
import { TooltipProvider } from '@/components/ui/tooltip';
import App from './App';
import './index.css';

// the browser-only build lives inside a hosted page whose URL it cannot change
const Router = STANDALONE ? MemoryRouter : BrowserRouter;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 1000, refetchOnWindowFocus: true, retry: 1 },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <TooltipProvider>
          <Router>
            <App />
          </Router>
          <Toaster position="bottom-right" richColors closeButton />
        </TooltipProvider>
      </I18nProvider>
    </QueryClientProvider>
  </StrictMode>,
);
