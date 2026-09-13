import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { router } from "./routes";
import "./shared/tokens.css";

/*
 * Never declare a top-level binding named `top`, `name`, `status`, `self`,
 * `parent` or `length`. They collide with non-configurable window properties and
 * the entire bundle throws before a single line runs. See CLAUDE.md §8.
 */

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      // Chapters are on poor mobile connections; do not refetch on every focus.
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
