import { useState, type CSSProperties, type FormEvent } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/shared/api";
import { useAuth } from "@/shared/auth";
import { EmptyState, ErrorState, ScreenSkeleton } from "@/shared/states";

interface EnrolmentLink {
  firstName: string;
  giftName: string;
  chapterName: string;
  expiresOnUtc: string;
}

/**
 * GET /api/enrolment/{token} — the API deliberately does not say whether a token is
 * expired, already redeemed, or simply unrecognised; a 404 always reads the same way
 * here: ask the chapter for a new link.
 */
export function Enrol() {
  const { token } = useParams<{ token: string }>();
  const { session, completeEnrolment } = useAuth();
  const navigate = useNavigate();

  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["enrolment", token],
    queryFn: () => api.get<EnrolmentLink>(`/api/enrolment/${token}`),
    retry: false,
  });

  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitErrors, setSubmitErrors] = useState<string[] | null>(null);

  if (session === "signed-in") return <Navigate to="/" replace />;

  if (isLoading) return <ScreenSkeleton rows={4} />;

  if (error) {
    if (error instanceof ApiError && error.status === 404) {
      return (
        <EmptyState
          title="This link is no longer valid"
          body="This link has expired or was already used. Ask your President or the System Admin for a new one."
        />
      );
    }
    return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;
  }

  if (!data) return <ScreenSkeleton rows={4} />;

  const who = data.giftName || data.firstName;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSubmitErrors(null);
    setSubmitting(true);
    try {
      await completeEnrolment(token, password);
      navigate("/", { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.errors) {
        setSubmitErrors(Object.values(err.errors).flat());
      } else {
        setSubmitErrors([err instanceof Error ? err.message : "Something went wrong. Please try again."]);
      }
      setSubmitting(false);
    }
  }

  return (
    <div style={{ minHeight: "100dvh", padding: "28px 20px" }}>
      <h1 style={{ fontFamily: "var(--f-disp)", fontSize: 24, letterSpacing: ".03em" }}>
        {who ? `Setting up ${who}’s account` : "Set your password"}
      </h1>
      {data.chapterName && (
        <p style={{ fontSize: 13, color: "var(--mute)", marginTop: 6 }}>{data.chapterName}</p>
      )}

      <form onSubmit={handleSubmit} style={{ marginTop: 26 }}>
        <label htmlFor="newPassword" style={labelStyle}>Choose a password</label>
        <input
          id="newPassword"
          value={password}
          onChange={e => setPassword(e.target.value)}
          type="password"
          autoComplete="new-password"
          style={fieldStyle}
        />
        <p style={hintStyle}>At least 10 characters. Pick something you have not used elsewhere.</p>

        {submitErrors?.map((msg, i) => (
          <p key={i} role="alert" style={errorStyle}>{msg}</p>
        ))}

        <button
          type="submit"
          disabled={submitting || password.length < 10}
          style={{ ...buttonStyle, opacity: submitting ? 0.7 : 1 }}
        >
          {submitting ? "Setting up…" : "Set password and sign in"}
        </button>
      </form>
    </div>
  );
}

const labelStyle: CSSProperties = { display: "block", fontSize: 13, color: "var(--slate)", marginBottom: 6 };

const fieldStyle: CSSProperties = {
  width: "100%", minHeight: "var(--tap)", padding: "0 12px", borderRadius: 8, fontSize: 15,
  border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)",
};

const hintStyle: CSSProperties = { fontSize: 12, color: "var(--mute)", marginTop: 6 };

const errorStyle: CSSProperties = { marginTop: 12, fontSize: 13, color: "var(--out)", lineHeight: 1.5 };

const buttonStyle: CSSProperties = {
  marginTop: 22, width: "100%", minHeight: "var(--tap)", borderRadius: 8,
  background: "var(--deep)", color: "var(--brass-soft)",
  fontFamily: "var(--f-disp)", fontSize: 16, letterSpacing: ".08em", textTransform: "uppercase",
};
