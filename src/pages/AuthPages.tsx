import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import {
  GITHUB_OAUTH_ENABLED,
  GOOGLE_OAUTH_ENABLED,
  useAuth,
} from "../context/AuthContext";
import ThemeToggle from "../components/ThemeToggle";
import "./AuthPage.css";

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

const TERMS_URL: string = import.meta.env.VITE_TERMS_URL || "/terms";
const PRIVACY_URL: string = import.meta.env.VITE_PRIVACY_URL || "/privacy";

const OAUTH_ERRORS: Record<string, string> = {
  github_failed: "GitHub sign-in failed. Please try again.",
  google_failed: "Google sign-in failed. Please try again.",
  access_denied: "Sign-in was cancelled.",
  account_exists:
    "An account with this email already exists. Sign in with your password instead.",
};

/* ------------------------------------------------------------------ */
/* Validation helpers                                                  */
/* ------------------------------------------------------------------ */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// 3–30 chars, must start and end with a letter/number
const USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{1,28}[A-Za-z0-9]$/;
const PASSWORD_MAX = 128;

const COMMON_PASSWORDS = new Set([
  "password",
  "password1",
  "password123",
  "12345678",
  "123456789",
  "1234567890",
  "qwertyui",
  "qwerty123",
  "iloveyou",
  "admin123",
  "letmein1",
  "welcome1",
  "abc12345",
]);

interface PasswordRule {
  id: string;
  label: string;
  test: (pw: string) => boolean;
}

const PASSWORD_RULES: PasswordRule[] = [
  { id: "len", label: "At least 8 characters", test: (pw) => pw.length >= 8 },
  { id: "lower", label: "One lowercase letter", test: (pw) => /[a-z]/.test(pw) },
  { id: "upper", label: "One uppercase letter", test: (pw) => /[A-Z]/.test(pw) },
  { id: "num", label: "One number", test: (pw) => /\d/.test(pw) },
  {
    id: "special",
    label: "One special character (!@#$…)",
    test: (pw) => /[^A-Za-z0-9\s]/.test(pw),
  },
];

const STRENGTH_LABELS = ["", "Weak", "Fair", "Good", "Strong"];

function scorePassword(pw: string): number {
  if (!pw) return 0;
  let s = PASSWORD_RULES.filter((r) => r.test(pw)).length; // 0–5
  if (pw.length >= 12) s += 1; // 0–6
  if (COMMON_PASSWORDS.has(pw.toLowerCase())) s = Math.min(s, 1);
  if (s <= 2) return 1;
  if (s === 3) return 2;
  if (s <= 5) return 3;
  return 4;
}

function getPasswordIssue(
  pw: string,
  ctx: { email?: string; username?: string } = {},
): string {
  if (!pw) return "Create a password.";
  if (pw.length > PASSWORD_MAX) {
    return `Password must be at most ${PASSWORD_MAX} characters.`;
  }
  const failed = PASSWORD_RULES.find((r) => !r.test(pw));
  if (failed) return `Password needs: ${failed.label.toLowerCase()}.`;
  if (COMMON_PASSWORDS.has(pw.toLowerCase())) {
    return "That password is too common. Choose something harder to guess.";
  }
  const lowered = pw.toLowerCase();
  const emailName = ctx.email?.split("@")[0]?.toLowerCase();
  if (emailName && emailName.length >= 3 && lowered.includes(emailName)) {
    return "Password shouldn't contain your email name.";
  }
  const uname = ctx.username?.toLowerCase().replace(/\s/g, "");
  if (uname && uname.length >= 3 && lowered.includes(uname)) {
    return "Password shouldn't contain your username.";
  }
  return "";
}

function validateEmail(value: string): string {
  const v = value.trim();
  if (!v) return "Enter your email address.";
  if (!EMAIL_RE.test(v)) return "Enter a valid email address.";
  return "";
}

/* ------------------------------------------------------------------ */
/* Misc helpers                                                        */
/* ------------------------------------------------------------------ */

type ApiError = {
  code?: string;
  message?: string;
  response?: { status?: number; data?: { message?: string } };
};

function getErrorMessage(err: unknown, fallback: string): string {
  const error = (err ?? {}) as ApiError;
  const status = error.response?.status;
  if (status === 429) {
    return "Too many attempts. Please wait a few minutes and try again.";
  }
  if (
    !error.response &&
    (error.code === "ERR_NETWORK" || error.message === "Network Error")
  ) {
    return "Can't reach the server. Check your connection and try again.";
  }
  if (status && status >= 500) {
    return "Something went wrong on our side. Please try again shortly.";
  }
  return error.response?.data?.message || error.message || fallback;
}

function getRedirect(state: unknown): string {
  const from = (state as { from?: { pathname?: string } } | null)?.from
    ?.pathname;
  return from && from.startsWith("/") && !from.startsWith("//")
    ? from
    : "/dashboard";
}

/* ------------------------------------------------------------------ */
/* Small UI pieces                                                     */
/* ------------------------------------------------------------------ */

interface AuthLayoutProps {
  title: string;
  sub: string;
  children: ReactNode;
}

function AuthLayout({ title, sub, children }: AuthLayoutProps): ReactElement {
  useEffect(() => {
    const previous = document.title;
    document.title = `${title} · RepoMind`;
    return () => {
      document.title = previous;
    };
  }, [title]);

  return (
    <main className="auth-page">
      <div className="auth-topbar">
        <Link to="/" className="auth-logo">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
              stroke="var(--accent)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          RepoMind
        </Link>
        <ThemeToggle className="theme-toggle--auth" />
      </div>
      <div className="auth-card card fade-in">
        <h1 className="auth-title">{title}</h1>
        <p className="auth-sub">{sub}</p>
        {children}
      </div>
    </main>
  );
}

interface TextFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string;
  type?: "text" | "email";
  autoComplete?: string;
  placeholder?: string;
  inputRef?: RefObject<HTMLInputElement>;
  autoFocus?: boolean;
}

function TextField({
  id,
  label,
  value,
  onChange,
  onBlur,
  error,
  type = "text",
  autoComplete,
  placeholder,
  inputRef,
  autoFocus,
}: TextFieldProps): ReactElement {
  const errId = `${id}-error`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        ref={inputRef}
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        autoCapitalize="none"
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errId : undefined}
        className={error ? "input-invalid" : undefined}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
      {error && (
        <span id={errId} className="field-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

interface PasswordFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string;
  autoComplete: "current-password" | "new-password";
  placeholder?: string;
  inputRef?: RefObject<HTMLInputElement>;
  children?: ReactNode;
  autoFocus?: boolean;
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  onBlur,
  error,
  autoComplete,
  placeholder,
  inputRef,
  children,
  autoFocus,
}: PasswordFieldProps): ReactElement {
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const errId = `${id}-error`;

  const detectCaps = (e: KeyboardEvent<HTMLInputElement>) => {
    setCapsLock(e.getModifierState ? e.getModifierState("CapsLock") : false);
  };

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="input-wrap">
        <input
          id={id}
          ref={inputRef}
          type={visible ? "text" : "password"}
          value={value}
          placeholder={placeholder}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          autoCapitalize="none"
          spellCheck={false}
          maxLength={PASSWORD_MAX}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errId : undefined}
          className={error ? "input-invalid" : undefined}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={detectCaps}
          onKeyUp={detectCaps}
          onBlur={() => {
            setCapsLock(false);
            onBlur?.();
          }}
        />
        <button
          type="button"
          className="pw-toggle"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
        >
          {visible ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </div>
      {capsLock && (
        <span className="caps-warning" role="status">
          Caps Lock is on
        </span>
      )}
      {error && (
        <span id={errId} className="field-error" role="alert">
          {error}
        </span>
      )}
      {children}
    </div>
  );
}

function PasswordStrength({ password }: { password: string }): ReactElement {
  const score = scorePassword(password);
  return (
    <div className="pw-strength">
      <div className="pw-strength__bar" aria-hidden="true">
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={i <= score ? `on level-${score}` : ""} />
        ))}
      </div>
      <span className="pw-strength__label" aria-live="polite">
        {password ? `Password strength: ${STRENGTH_LABELS[score]}` : "Password strength"}
      </span>
      <ul className="pw-rules">
        {PASSWORD_RULES.map((rule) => {
          const met = rule.test(password);
          return (
            <li key={rule.id} className={met ? "met" : ""}>
              <span aria-hidden="true">{met ? "✓" : "○"}</span>
              <span className="sr-only">{met ? "Met: " : "Not met: "}</span>
              {rule.label}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function GithubButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}): ReactElement {
  return (
    <button type="button" className="github-auth-btn" onClick={onClick}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
      </svg>
      <span>{label}</span>
    </button>
  );
}

function GoogleButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}): ReactElement {
  return (
    <button type="button" className="google-auth-btn" onClick={onClick}>
      <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 2.56 34.78l7.97-6.19z" />
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
      </svg>
      <span>{label}</span>
    </button>
  );
}

function SocialAuth({ mode }: { mode: "signin" | "signup" }): ReactElement | null {
  const { loginWithGithub, loginWithGoogle } = useAuth();
  const [error, setError] = useState("");

  if (!GITHUB_OAUTH_ENABLED && !GOOGLE_OAUTH_ENABLED) return null;

  const verb = mode === "signin" ? "Continue with" : "Sign up with";
  const start = (fn: () => void) => () => {
    setError("");
    try {
      fn();
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Could not start sign-in. Please try again."));
    }
  };

  return (
    <>
      <div className="auth-social">
        {GOOGLE_OAUTH_ENABLED && (
          <GoogleButton label={`${verb} Google`} onClick={start(loginWithGoogle)} />
        )}
        {GITHUB_OAUTH_ENABLED && (
          <GithubButton label={`${verb} GitHub`} onClick={start(loginWithGithub)} />
        )}
      </div>
      {error && (
        <div className="auth-error" role="alert">
          {error}
        </div>
      )}
      <div className="auth-divider">
        <span>or use email</span>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Login                                                               */
/* ------------------------------------------------------------------ */

export function LoginPage(): ReactElement {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const [form, setForm] = useState({ email: "", password: "", remember: true });
  const [touched, setTouched] = useState<{ email?: boolean; password?: boolean }>({});
  const [submitError, setSubmitError] = useState("");
  const [loading, setLoading] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const notice = (location.state as { notice?: string } | null)?.notice ?? "";
  const oauthError = OAUTH_ERRORS[searchParams.get("error") ?? ""] ?? "";

  const errors = {
    email: validateEmail(form.email),
    password: form.password ? "" : "Enter your password.",
  };

  const handle = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (loading) return;
    setSubmitError("");
    setTouched({ email: true, password: true });

    if (errors.email) {
      emailRef.current?.focus();
      return;
    }
    if (errors.password) {
      passwordRef.current?.focus();
      return;
    }

    setLoading(true);
    try {
      await login(form.email.trim().toLowerCase(), form.password, form.remember);
      navigate(getRedirect(location.state), { replace: true });
    } catch (err: unknown) {
      setSubmitError(getErrorMessage(err, "Sign in failed. Please try again."));
      setForm((f) => ({ ...f, password: "" }));
      passwordRef.current?.focus();
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title="Welcome back" sub="Sign in to your RepoMind account">
      {notice && (
        <div className="auth-notice" role="status">
          {notice}
        </div>
      )}
      {oauthError && (
        <div className="auth-error" role="alert">
          {oauthError}
        </div>
      )}
      {import.meta.env.DEV && (
        <div className="auth-hint">
          Dev demo account: <strong>demo@repomind.dev</strong> / <strong>demo1234</strong>
        </div>
      )}

      <SocialAuth mode="signin" />

      <form onSubmit={handle} noValidate>
        <TextField
          id="login-email"
          label="Email"
          type="email"
          placeholder="you@example.com"
          autoComplete="username"
          value={form.email}
          inputRef={emailRef}
          autoFocus
          error={touched.email ? errors.email : ""}
          onChange={(v) => setForm((f) => ({ ...f, email: v }))}
          onBlur={() => setTouched((t) => ({ ...t, email: true }))}
        />
        <PasswordField
          id="login-password"
          label="Password"
          placeholder="Your password"
          autoComplete="current-password"
          value={form.password}
          inputRef={passwordRef}
          error={touched.password ? errors.password : ""}
          onChange={(v) => setForm((f) => ({ ...f, password: v }))}
          onBlur={() => setTouched((t) => ({ ...t, password: true }))}
        />

        <div className="auth-row">
          <label className="auth-check">
            <input
              type="checkbox"
              checked={form.remember}
              onChange={(e) => setForm((f) => ({ ...f, remember: e.target.checked }))}
            />
            <span>Remember me</span>
          </label>
          <Link to="/forgot-password" className="auth-link">
            Forgot password?
          </Link>
        </div>

        {submitError && (
          <div className="auth-error" role="alert">
            {submitError}
          </div>
        )}
        <button type="submit" className="btn-primary auth-submit" disabled={loading} aria-busy={loading}>
          {loading ? "Signing in..." : "Sign in →"}
        </button>
      </form>

      <p className="auth-switch">
        Don't have an account? <Link to="/signup">Sign up</Link>
      </p>
    </AuthLayout>
  );
}

/* ------------------------------------------------------------------ */
/* Signup                                                              */
/* ------------------------------------------------------------------ */

type SignupKey = "username" | "email" | "password" | "confirm" | "terms";

export function SignupPage(): ReactElement {
  const { signup } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    username: "",
    email: "",
    password: "",
    confirm: "",
    terms: false,
    website: "", // honeypot — real users never fill this
  });
  const [touched, setTouched] = useState<Partial<Record<SignupKey, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [loading, setLoading] = useState(false);

  const refs: Record<SignupKey, RefObject<HTMLInputElement>> = {
    username: useRef<HTMLInputElement>(null),
    email: useRef<HTMLInputElement>(null),
    password: useRef<HTMLInputElement>(null),
    confirm: useRef<HTMLInputElement>(null),
    terms: useRef<HTMLInputElement>(null),
  };

  const username = form.username.trim();
  const email = form.email.trim().toLowerCase();

  const errors: Record<SignupKey, string> = {
    username: !username
      ? "Choose a username."
      : !USERNAME_RE.test(username)
        ? "Use 3–30 characters: letters, numbers, spaces, . _ -"
        : "",
    email: validateEmail(form.email),
    password: getPasswordIssue(form.password, { email, username }),
    confirm: !form.confirm
      ? "Confirm your password."
      : form.confirm !== form.password
        ? "Passwords don't match."
        : "",
    terms: form.terms ? "" : "You must accept the Terms and Privacy Policy.",
  };

  const visible = (key: SignupKey): string =>
    touched[key] || submitted ? errors[key] : "";
  const touch = (key: SignupKey) => () => setTouched((t) => ({ ...t, [key]: true }));

  const handle = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (loading) return;
    setSubmitted(true);
    setSubmitError("");

    const firstInvalid = (Object.keys(errors) as SignupKey[]).find((k) => errors[k]);
    if (firstInvalid) {
      refs[firstInvalid].current?.focus();
      return;
    }
    if (form.website) return; // bot filled the honeypot — silently ignore

    setLoading(true);
    try {
      await signup(username, email, form.password);
      navigate("/dashboard", { replace: true });
    } catch (err: unknown) {
      setSubmitError(getErrorMessage(err, "Sign up failed. Please try again."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title="Create account" sub="Start automating your PRs with RepoMind">
      <SocialAuth mode="signup" />

      <form onSubmit={handle} noValidate>
        <TextField
          id="signup-username"
          label="Username"
          placeholder="yourname"
          autoComplete="username"
          value={form.username}
          inputRef={refs.username}
          autoFocus
          error={visible("username")}
          onChange={(v) => setForm((f) => ({ ...f, username: v }))}
          onBlur={touch("username")}
        />
        <TextField
          id="signup-email"
          label="Email"
          type="email"
          placeholder="you@example.com"
          autoComplete="email"
          value={form.email}
          inputRef={refs.email}
          error={visible("email")}
          onChange={(v) => setForm((f) => ({ ...f, email: v }))}
          onBlur={touch("email")}
        />
        <PasswordField
          id="signup-password"
          label="Password"
          placeholder="Create a strong password"
          autoComplete="new-password"
          value={form.password}
          inputRef={refs.password}
          error={visible("password")}
          onChange={(v) => setForm((f) => ({ ...f, password: v }))}
          onBlur={touch("password")}
        >
          <PasswordStrength password={form.password} />
        </PasswordField>
        <PasswordField
          id="signup-confirm"
          label="Confirm password"
          placeholder="Re-enter your password"
          autoComplete="new-password"
          value={form.confirm}
          inputRef={refs.confirm}
          error={visible("confirm")}
          onChange={(v) => setForm((f) => ({ ...f, confirm: v }))}
          onBlur={touch("confirm")}
        />

        <div className="hp-field" aria-hidden="true">
          <label htmlFor="signup-website">Website</label>
          <input
            id="signup-website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={form.website}
            onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
          />
        </div>

        <div className="field">
          <label className="auth-check">
            <input
              ref={refs.terms}
              type="checkbox"
              checked={form.terms}
              aria-invalid={visible("terms") ? true : undefined}
              aria-describedby={visible("terms") ? "signup-terms-error" : undefined}
              onChange={(e) => setForm((f) => ({ ...f, terms: e.target.checked }))}
              onBlur={touch("terms")}
            />
            <span>
              I agree to the{" "}
              <a href={TERMS_URL} target="_blank" rel="noopener noreferrer" className="auth-link">
                Terms of Service
              </a>{" "}
              and{" "}
              <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer" className="auth-link">
                Privacy Policy
              </a>
              .
            </span>
          </label>
          {visible("terms") && (
            <span id="signup-terms-error" className="field-error" role="alert">
              {visible("terms")}
            </span>
          )}
        </div>

        {submitError && (
          <div className="auth-error" role="alert">
            {submitError}
          </div>
        )}
        <button type="submit" className="btn-primary auth-submit" disabled={loading} aria-busy={loading}>
          {loading ? "Creating account..." : "Create account →"}
        </button>
      </form>

      <p className="auth-switch">
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
    </AuthLayout>
  );
}

/* ------------------------------------------------------------------ */
/* Forgot password                                                     */
/* ------------------------------------------------------------------ */

export function ForgotPasswordPage(): ReactElement {
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState(false);
  const [sent, setSent] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [loading, setLoading] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  const emailError = validateEmail(email);

  const handle = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (loading) return;
    setSubmitError("");
    setTouched(true);
    if (emailError) {
      emailRef.current?.focus();
      return;
    }

    setLoading(true);
    try {
      await requestPasswordReset(email.trim().toLowerCase());
      setSent(true);
    } catch (err: unknown) {
      setSubmitError(getErrorMessage(err, "Could not send the reset link. Please try again."));
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <AuthLayout title="Check your email" sub="Password reset instructions are on their way">
        <div className="auth-notice" role="status">
          If an account exists for <strong>{email.trim().toLowerCase()}</strong>, we've sent a
          link to reset your password. It expires soon, so use it right away.
        </div>
        <p className="auth-legal">
          Didn't get it? Check your spam folder or{" "}
          <button
            type="button"
            className="auth-link auth-link--button"
            onClick={() => setSent(false)}
          >
            try a different email
          </button>
          .
        </p>
        <p className="auth-switch">
          <Link to="/login">← Back to sign in</Link>
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Forgot password?" sub="Enter your email and we'll send you a reset link">
      <form onSubmit={handle} noValidate>
        <TextField
          id="forgot-email"
          label="Email"
          type="email"
          placeholder="you@example.com"
          autoComplete="email"
          value={email}
          inputRef={emailRef}
          autoFocus
          error={touched ? emailError : ""}
          onChange={setEmail}
          onBlur={() => setTouched(true)}
        />
        {submitError && (
          <div className="auth-error" role="alert">
            {submitError}
          </div>
        )}
        <button type="submit" className="btn-primary auth-submit" disabled={loading} aria-busy={loading}>
          {loading ? "Sending..." : "Send reset link →"}
        </button>
      </form>
      <p className="auth-switch">
        <Link to="/login">← Back to sign in</Link>
      </p>
    </AuthLayout>
  );
}

/* ------------------------------------------------------------------ */
/* Reset password                                                      */
/* ------------------------------------------------------------------ */

export function ResetPasswordPage(): ReactElement {
  const { resetPassword } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [form, setForm] = useState({ password: "", confirm: "" });
  const [touched, setTouched] = useState<{ password?: boolean; confirm?: boolean }>({});
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [loading, setLoading] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  const errors = {
    password: getPasswordIssue(form.password),
    confirm: !form.confirm
      ? "Confirm your new password."
      : form.confirm !== form.password
        ? "Passwords don't match."
        : "",
  };

  const handle = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (loading) return;
    setSubmitted(true);
    setSubmitError("");

    if (errors.password) {
      passwordRef.current?.focus();
      return;
    }
    if (errors.confirm) {
      confirmRef.current?.focus();
      return;
    }

    setLoading(true);
    try {
      await resetPassword(token, form.password);
      navigate("/login", {
        replace: true,
        state: { notice: "Password updated. Sign in with your new password." },
      });
    } catch (err: unknown) {
      setSubmitError(
        getErrorMessage(err, "This reset link is invalid or has expired. Please request a new one."),
      );
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <AuthLayout title="Link not valid" sub="This password reset link is missing or incomplete">
        <p className="auth-legal">Please request a new reset link and try again.</p>
        <Link to="/forgot-password" className="btn-primary auth-submit auth-submit--link">
          Request a new link
        </Link>
        <p className="auth-switch">
          <Link to="/login">← Back to sign in</Link>
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Set a new password" sub="Choose a strong password you haven't used before">
      <form onSubmit={handle} noValidate>
        <PasswordField
          id="reset-password"
          label="New password"
          placeholder="Create a strong password"
          autoComplete="new-password"
          value={form.password}
          inputRef={passwordRef}
          autoFocus
          error={touched.password || submitted ? errors.password : ""}
          onChange={(v) => setForm((f) => ({ ...f, password: v }))}
          onBlur={() => setTouched((t) => ({ ...t, password: true }))}
        >
          <PasswordStrength password={form.password} />
        </PasswordField>
        <PasswordField
          id="reset-confirm"
          label="Confirm new password"
          placeholder="Re-enter your password"
          autoComplete="new-password"
          value={form.confirm}
          inputRef={confirmRef}
          error={touched.confirm || submitted ? errors.confirm : ""}
          onChange={(v) => setForm((f) => ({ ...f, confirm: v }))}
          onBlur={() => setTouched((t) => ({ ...t, confirm: true }))}
        />

        {submitError && (
          <div className="auth-error" role="alert">
            {submitError}
          </div>
        )}
        <button type="submit" className="btn-primary auth-submit" disabled={loading} aria-busy={loading}>
          {loading ? "Updating..." : "Update password →"}
        </button>
      </form>
      <p className="auth-switch">
        <Link to="/login">← Back to sign in</Link>
      </p>
    </AuthLayout>
  );
}