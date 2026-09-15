import { useEffect, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/shared/api";
import {
  getExistingSubscription, getPushPlatformState, subscribeToPush, unsubscribeFromPush,
  type PushPlatformState,
} from "@/shared/push";
import type { NotificationPreference } from "@/shared/types";

/**
 * Message-alert settings — a section rendered INSIDE Profile.tsx, not a route of its
 * own (see routes.tsx: there is no /notifications entry, by design).
 *
 * Endpoints:
 *   GET/PUT /api/notifications/preferences — the two always-available toggles at the
 *     bottom, independent of whether push itself can fire on this device: they still
 *     govern in-app relevance today and take effect for push the moment it becomes
 *     available, so they are never gated on platform support.
 *   GET /api/notifications/vapid-key, POST/DELETE /api/notifications/subscriptions —
 *     reached only through shared/push.ts, and only on a platform that can actually
 *     deliver push.
 *
 * Four platform states (shared/push.ts's PushPlatformState) decide what the top
 * section shows. This mirrors the same honesty rule DigitalId's verified-live/
 * verified-offline/invalid QR states already apply (CLAUDE.md: "never show a
 * confident state you cannot back") — a platform that cannot deliver push is never
 * shown a green "on" toggle, only plain, warm copy explaining why.
 */
export function NotificationSettings() {
  const [platformState] = useState<PushPlatformState>(() => getPushPlatformState());

  const [subscribed, setSubscribed] = useState(false);
  const [checkingSubscription, setCheckingSubscription] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  // Read from the browser's own PushManager, never inferred from a stored id alone —
  // the browser can drop a subscription (cleared site data, a reinstalled PWA)
  // without this app ever hearing about it. See push.ts's own header comment.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const existing = await getExistingSubscription();
      if (!cancelled) {
        setSubscribed(existing !== null);
        setCheckingSubscription(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const preferencesQuery = useQuery({
    queryKey: ["notification-preferences"],
    queryFn: () => api.get<NotificationPreference>("/api/notifications/preferences"),
  });

  // MUST run inside this direct click handler — iOS silently refuses the permission
  // prompt otherwise (see push.ts's own header comment on subscribeToPush).
  async function handlePushToggle() {
    setToggleError(null);
    setToggling(true);
    try {
      if (subscribed) {
        await unsubscribeFromPush();
        setSubscribed(false);
      } else {
        const result = await subscribeToPush();
        if (result.ok) {
          setSubscribed(true);
        } else if (result.reason === "permission-denied") {
          setToggleError(
            "You said no to notifications. If you change your mind, turn them back on from your phone's own Settings.");
        } else {
          setToggleError("Could not turn on message alerts. Please check your connection and try again.");
        }
      }
    } finally {
      setToggling(false);
    }
  }

  async function setPreference(patch: Partial<NotificationPreference>) {
    const current = preferencesQuery.data ?? { privateMessagePush: true, mentionPush: true };
    const next = { ...current, ...patch };
    try {
      await api.put("/api/notifications/preferences", next);
      await preferencesQuery.refetch();
    } catch {
      // Best-effort — refetch above simply leaves the toggle showing the server's
      // last-known state; there is nothing else for the member to act on here.
    }
  }

  return (
    <div>
      <div style={sectionLabelStyle}>Message alerts</div>
      <div style={cardStyle}>
        <PlatformSection
          state={platformState}
          subscribed={subscribed}
          checking={checkingSubscription}
          toggling={toggling}
          onToggle={() => { void handlePushToggle(); }}
        />
        {toggleError && <p role="alert" style={errorTextStyle}>{toggleError}</p>}
      </div>

      <div style={{ ...cardStyle, marginTop: 12 }}>
        <ToggleRow
          label="Private messages"
          hint="Get an alert when a brother sends you a private message."
          checked={preferencesQuery.data?.privateMessagePush ?? true}
          disabled={preferencesQuery.isLoading}
          onChange={checked => { void setPreference({ privateMessagePush: checked }); }}
        />
        <ToggleRow
          label="When someone mentions me"
          hint="Get an alert when someone @-mentions you in the chapter chat."
          checked={preferencesQuery.data?.mentionPush ?? true}
          disabled={preferencesQuery.isLoading}
          onChange={checked => { void setPreference({ mentionPush: checked }); }}
          last
        />
      </div>
    </div>
  );
}

function PlatformSection({ state, subscribed, checking, toggling, onToggle }: {
  state: PushPlatformState; subscribed: boolean; checking: boolean; toggling: boolean; onToggle: () => void;
}) {
  if (state === "ios-not-installed") {
    return (
      <p style={plainTextStyle}>
        To get message alerts on iPhone, first add AIS to your Home Screen: tap Share, then Add to Home Screen.
      </p>
    );
  }

  if (state === "unsupported") {
    return (
      <p style={plainTextStyle}>
        Your browser doesn't support message alerts yet. You'll still see new messages when you open the app.
      </p>
    );
  }

  const isIOSInstalled = state === "supported-ios";
  const onLabel = isIOSInstalled
    ? "Message alerts are on. On iPhone they can arrive a little late."
    : "Message alerts are on.";
  const offLabel = "Message alerts are off.";

  return (
    <label style={{ ...toggleRowStyle, borderBottom: "none" }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 14 }}>{subscribed ? onLabel : offLabel}</span>
        {!isIOSInstalled && (
          <span style={hintStyle}>
            You'll get a phone alert for new private messages and mentions, even when the app is closed.
          </span>
        )}
      </span>
      <input
        type="checkbox" role="switch" checked={subscribed}
        disabled={checking || toggling}
        onChange={onToggle}
        style={switchStyle}
      />
    </label>
  );
}

function ToggleRow({ label, hint, checked, disabled, onChange, last }: {
  label: string; hint: string; checked: boolean; disabled?: boolean;
  onChange: (checked: boolean) => void; last?: boolean;
}) {
  return (
    <label style={last ? { ...toggleRowStyle, borderBottom: "none" } : toggleRowStyle}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 14 }}>{label}</span>
        <span style={hintStyle}>{hint}</span>
      </span>
      <input
        type="checkbox" role="switch" checked={checked} disabled={disabled}
        onChange={e => onChange(e.target.checked)}
        style={switchStyle}
      />
    </label>
  );
}

const sectionLabelStyle: CSSProperties = {
  fontFamily: "var(--f-disp)", fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase",
  color: "var(--mute)", padding: "18px 0 8px",
};

const cardStyle: CSSProperties = {
  padding: "4px 14px", borderRadius: "var(--r)", background: "var(--paper)", border: "1px solid var(--line)",
};

const toggleRowStyle: CSSProperties = {
  display: "flex", alignItems: "center", gap: 12, minHeight: "var(--tap)", padding: "12px 0",
  borderBottom: "1px solid var(--line)", cursor: "pointer",
};

const hintStyle: CSSProperties = { display: "block", fontSize: 12, color: "var(--mute)", marginTop: 3, lineHeight: 1.5 };

const plainTextStyle: CSSProperties = { fontSize: 13.5, color: "var(--slate)", lineHeight: 1.6, padding: "12px 0" };

const errorTextStyle: CSSProperties = { fontSize: 12.5, color: "var(--out)", lineHeight: 1.5, padding: "0 0 12px" };

const switchStyle: CSSProperties = { flex: "none", width: 20, height: 20 };
