import { useState, type CSSProperties, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { ApiError } from "@/shared/api";
import { useAuth } from "@/shared/auth";

/**
 * The login page is identical for every chapter — before sign-in the system does not
 * know who the person is, so it carries no chapter mark (docs/AIS-Project-Documentation.md
 * §7A.3). Once signed in, AppShell shows the chapter's own identity.
 */
export function SignIn() {
  const { session, signIn } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const [memberNumber, setMemberNumber] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const destination = (location.state as { from?: { pathname?: string } } | null)
    ?.from?.pathname ?? "/";

  if (session === "signed-in") return <Navigate to={destination} replace />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signIn(memberNumber.trim(), password);
      navigate(destination, { replace: true });
    } catch (err) {
      // The backend deliberately returns a generic 401 for every reason a sign-in can
      // fail, so the account list is never disclosed. Match that here.
      if (err instanceof ApiError && err.status === 401) {
        setError("Member number or password is incorrect.");
      } else {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
      setSubmitting(false);
    }
  }

  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", background: "var(--bond)" }}>
      <div style={{ background: "var(--deep)", padding: "56px 24px 34px", textAlign: "center" }}>
        <div style={{ fontFamily: "var(--f-disp)", fontSize: 42, letterSpacing: ".1em", color: "var(--paper)" }}>
          AIS
        </div>
        <div style={{ fontSize: 12, color: "var(--mute)", marginTop: 10, letterSpacing: ".03em" }}>
          AKRHO Information System
        </div>
        <div style={{ fontSize: 12, color: "var(--mute)", marginTop: 4, letterSpacing: ".03em" }}>
          Alpha Kappa Rho &middot; Philippines
        </div>
      </div>

      <form onSubmit={handleSubmit} style={{ flex: 1, padding: "28px 20px" }}>
        <label htmlFor="memberNumber" style={labelStyle}>Member number or mobile number</label>
        <input
          id="memberNumber"
          value={memberNumber}
          onChange={e => setMemberNumber(e.target.value)}
          autoComplete="username"
          placeholder="AKR-04-0117-001 or 09171234567"
          style={fieldStyle}
        />
        <p style={hintStyle}>Your member number is on your ID card — or just use your mobile number.</p>

        <label htmlFor="password" style={labelStyle}>Password</label>
        <input
          id="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          type="password"
          autoComplete="current-password"
          style={fieldStyle}
        />

        {error && <p role="alert" style={errorStyle}>{error}</p>}

        <button
          type="submit"
          disabled={submitting || !memberNumber.trim() || !password}
          style={{ ...buttonStyle, opacity: submitting ? 0.7 : 1 }}
        >
          {submitting ? "Signing in…" : "Sign in"}
        </button>

        <p style={{ marginTop: 28, fontSize: 12.5, color: "var(--mute)", textAlign: "center", lineHeight: 1.6 }}>
          Trouble signing in? Ask your chapter's officers for help.
        </p>

        <p style={{ marginTop: 14, fontSize: 12.5, textAlign: "center", lineHeight: 1.6 }}>
          New here? <Link to="/apply" style={{ color: "var(--info)" }}>Apply to join a chapter</Link>.
        </p>
        <p style={{ marginTop: 6, fontSize: 12.5, textAlign: "center", lineHeight: 1.6 }}>
          Starting a new chapter? <Link to="/register-chapter" style={{ color: "var(--info)" }}>Register it here</Link>.
        </p>
      </form>
    </div>
  );
}

const labelStyle: CSSProperties = {
  display: "block", fontSize: 13, color: "var(--slate)", marginBottom: 6, marginTop: 18,
};

const fieldStyle: CSSProperties = {
  width: "100%", minHeight: "var(--tap)", padding: "0 12px", borderRadius: 8, fontSize: 15,
  border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)",
};

const hintStyle: CSSProperties = { fontSize: 12, color: "var(--mute)", marginTop: 6 };

const errorStyle: CSSProperties = { marginTop: 16, fontSize: 13, color: "var(--out)", lineHeight: 1.5 };

const buttonStyle: CSSProperties = {
  marginTop: 26, width: "100%", minHeight: "var(--tap)", borderRadius: 8,
  background: "var(--deep)", color: "var(--brass-soft)",
  fontFamily: "var(--f-disp)", fontSize: 16, letterSpacing: ".08em", textTransform: "uppercase",
};
