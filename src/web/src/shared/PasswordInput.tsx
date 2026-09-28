import { useState, type CSSProperties, type InputHTMLAttributes } from "react";

/**
 * A password `<input>` with a show/hide toggle — every password field in the app
 * (sign-in, enrolment, change-password) used a bare `type="password"` with no way to
 * check what you'd typed, easy to mistype on a phone keyboard. Drop-in replacement:
 * takes the same props as a plain `<input>` (minus `type`, which this owns) so each
 * screen's existing `style` (its own `fieldStyle`/`inputStyle`) still applies unchanged.
 */
export function PasswordInput(
  { style, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, "type">,
) {
  const [visible, setVisible] = useState(false);

  return (
    <div style={wrapStyle}>
      <input {...rest} type={visible ? "text" : "password"} style={{ ...style, paddingRight: 44 }} />
      <button
        type="button"
        onClick={() => setVisible(v => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        style={toggleStyle}
      >
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
}

function EyeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12Z"
        stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3.25" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3.5 3.5l17 17M9.9 5.5c.68-.16 1.4-.25 2.1-.25 7 0 10.5 7 10.5 7-.6 1.2-1.55 2.66-2.9 3.95M6.3 6.9C3.5 8.8 1.5 12 1.5 12S5 19 12 19c1.28 0 2.46-.23 3.5-.62M14.1 14.1a3.25 3.25 0 0 1-4.6-4.6"
        stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

const wrapStyle: CSSProperties = { position: "relative" };

const toggleStyle: CSSProperties = {
  position: "absolute", top: 0, right: 0, bottom: 0, width: 44,
  display: "flex", alignItems: "center", justifyContent: "center",
  color: "var(--slate)", background: "transparent", border: "none", padding: 0,
};
