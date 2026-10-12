import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "./router.tsx";
import { ToastProvider } from "./components/ui.tsx";
import { App } from "./App.tsx";
import "../../web/tokens.css";
import "./styles.css";
import "./premium.css";
import "./dark.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      // Yetki ve oturum hatalarında tekrar deneme anlamsız
      retry: (count, err) => count < 2 && !(err instanceof Error && "status" in err && [401, 403, 404].includes((err as { status: number }).status)),
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Router>
        <ToastProvider>
          <App />
        </ToastProvider>
      </Router>
    </QueryClientProvider>
  </StrictMode>,
);
