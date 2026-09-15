/**
 * The public-chat SignalR connection (src/Akrho.Api/Features/Chat/ChatHub.cs), at
 * "/hubs/chat" — a RELATIVE url, never a hardcoded origin (CLAUDE.md invariant #11:
 * one deployment, one URL). The dev proxy for this path is vite.config.ts's own
 * "/hubs" entry; in production it is same-origin.
 *
 * The hub has ZERO client-callable methods — this hook only listens. Every write
 * (post/flag/remove/resolve-flags) goes through the REST endpoints in api.ts callers;
 * the hub's job is purely to push MessagePosted/MessageRemoved/MessageFlagged after
 * those writes have already committed server-side.
 *
 * The JWT rides as `?access_token=` on the WebSocket handshake (browsers cannot set an
 * Authorization header there) — `accessTokenFactory` below is what makes
 * @microsoft/signalr do that automatically, and it is read fresh on every
 * connect/reconnect attempt rather than captured once, since a token can be refreshed
 * mid-session.
 *
 * Do NOT name anything here `status` at module/top level — see CLAUDE.md §8's
 * `window.status` collision rule. The exported state is `ChatConnectionStatus`, held
 * in a variable called `status` only INSIDE this hook's own React state, never as a
 * bare top-level binding.
 */
import { useEffect, useRef, useState } from "react";
import { HubConnectionBuilder, LogLevel, type HubConnection } from "@microsoft/signalr";
import { getAccessToken } from "@/shared/api";

export type ChatConnectionStatus = "connecting" | "live" | "reconnecting" | "offline";

export interface ChatConnection {
  status: ChatConnectionStatus;
  /**
   * Null until the connection has actually started at least once. Callers subscribe
   * with connection.on("MessagePosted"|"MessageRemoved"|"MessageFlagged", handler) —
   * see ChatHub.cs's own header comment for the exact event names and payload shapes.
   */
  connection: HubConnection | null;
}

/**
 * One HubConnection per mounted screen. Every failure mode — a start() that never
 * resolves, a start() that rejects, automatic-reconnect giving up, an unmount racing a
 * pending start() — resolves to the "offline" status, and NEVER a console.error or an
 * uncaught rejection: the route smoke test (npm run smoke) asserts zero console errors
 * on every route, and a real HubConnection failing inside jsdom would otherwise spam it.
 */
export function useChatConnection(chapterId: number): ChatConnection {
  const [status, setStatus] = useState<ChatConnectionStatus>("connecting");
  const [connection, setConnection] = useState<HubConnection | null>(null);
  // Guards every async continuation below against setting state after this effect's
  // own cleanup has already run (unmount, or chapterId changing mid-connect).
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    setStatus("connecting");
    setConnection(null);

    const conn = new HubConnectionBuilder()
      .withUrl("/hubs/chat", { accessTokenFactory: () => getAccessToken() ?? "" })
      .withAutomaticReconnect()
      // The SDK's own console logging is noise this app doesn't want on a phone's
      // devtools, and — more importantly — the smoke test treats ANY console.error as
      // a failure; SignalR logs failed reconnect attempts at Error level by default.
      .configureLogging(LogLevel.None)
      .build();

    conn.onreconnecting(() => { if (!cancelledRef.current) setStatus("reconnecting"); });
    conn.onreconnected(() => { if (!cancelledRef.current) setStatus("live"); });
    conn.onclose(() => { if (!cancelledRef.current) setStatus("offline"); });

    conn.start()
      .then(() => {
        if (cancelledRef.current) return;
        setStatus("live");
        setConnection(conn);
      })
      .catch(() => {
        // A dead network, an unreachable API in dev, a 401 the token refresh hasn't
        // caught up with yet — all of these are ordinary "offline" for this screen,
        // never a thrown error or a logged one.
        if (!cancelledRef.current) setStatus("offline");
      });

    return () => {
      cancelledRef.current = true;
      setConnection(null);
      conn.stop().catch(() => {
        // Disposing — nothing left to report to, and nothing the user can act on.
      });
    };
  }, [chapterId]);

  return { status, connection };
}
