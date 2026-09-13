import { createBrowserRouter, Navigate } from "react-router-dom";
import { MemberDirectory } from "@/ais/screens/MemberDirectory";
import { Ledger } from "@/ais/screens/Ledger";
import { AppShell } from "@/shared/AppShell";

/**
 * Every route added here MUST also be added to scripts/smoke.mjs.
 * A route that is not in the smoke list is a route nobody checks.
 */
export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/members" replace /> },
      { path: "members", element: <MemberDirectory /> },
      { path: "ledger", element: <Ledger chapterId={1} /> },
      // TODO next: /meetings, /id, /scan, /seals, /portal/*
    ],
  },
]);
