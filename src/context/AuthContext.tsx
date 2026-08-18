import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import api, { USER_KEY, clearSession } from "../utils/api";
import type { ApiErrorResponse, AuthResponse, AuthUser, LocalUser } from "../types";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<AuthResponse>;
  signup: (username: string, email: string, password: string) => Promise<AuthResponse>;
  loginWithGithub: () => void;
  logout: () => void;
  refreshUser: () => Promise<AuthUser | null>;
}

interface AuthProviderProps {
  children: ReactNode;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const STORAGE_KEYS = {
  user: USER_KEY,
  users: "rm_users",
  localSession: "rm_local_session",
};

const DEMO_USER = {
  id: "demo-user",
  username: "Demo User",
  email: "demo@repomind.dev",
  password: "demo1234",
};

/** GitHub OAuth is enabled unless explicitly disabled. */
export const GITHUB_OAUTH_ENABLED =
  import.meta.env.VITE_GITHUB_OAUTH_ENABLED !== "false";

function readJson<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}

function getApiOrigin(): string {
  const baseURL = api.defaults.baseURL || "/api";
  return new URL(baseURL, window.location.origin).toString().replace(/\/$/, "");
}

function stripSensitive(
  user: (AuthUser & { password?: string }) | null | undefined
): AuthUser | null {
  if (!user) return null;
  const safeUser = { ...user };
  delete safeUser.password;
  return safeUser;
}

/** Persist the cached user only — the session itself lives in the httpOnly cookie. */
function persistSession(user: AuthUser | null): void {
  if (user) {
    writeJson(STORAGE_KEYS.user, user);
  }
}

function ensureLocalUsers(): LocalUser[] {
  const storedUsers = readJson<LocalUser[] | null>(STORAGE_KEYS.users, null);
  if (Array.isArray(storedUsers) && storedUsers.length > 0) {
    return storedUsers;
  }

  const seededUsers = [DEMO_USER];
  writeJson(STORAGE_KEYS.users, seededUsers);
  return seededUsers;
}

function shouldUseLocalFallback(error: unknown): boolean {
  const apiError = error as ApiErrorResponse;
  return !apiError.response || (apiError.response.status ?? 0) >= 500;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const cachedUser = readJson<AuthUser | null>(STORAGE_KEYS.user, null);
    const isLocalSession = localStorage.getItem(STORAGE_KEYS.localSession) === "true";

    // No way to know if a real cookie session exists without asking the server —
    // httpOnly cookies aren't readable from JS. Always check /auth/me on mount.
    api
      .get("/auth/me")
      .then((r) => {
        const nextUser = stripSensitive(r.data as AuthUser);
        if (nextUser) {
          writeJson(STORAGE_KEYS.user, nextUser);
          setUser(nextUser);
        }
      })
      .catch((error: unknown) => {
        if (isLocalSession && shouldUseLocalFallback(error) && cachedUser) {
          setUser(cachedUser);
          return;
        }

        clearSession();
        localStorage.removeItem(STORAGE_KEYS.localSession);
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string): Promise<AuthResponse> => {
    try {
      const { data } = await api.post("/auth/login", { email, password });
      const nextUser = stripSensitive(data.user as LocalUser | AuthUser);
      localStorage.removeItem(STORAGE_KEYS.localSession);
      persistSession(nextUser);
      setUser(nextUser);
      return { user: nextUser };
    } catch (error: unknown) {
      if (!shouldUseLocalFallback(error)) throw error;

      const localUsers = ensureLocalUsers();
      const match = localUsers.find(
        (account) =>
          account.email.toLowerCase() === email.toLowerCase() &&
          account.password === password
      );

      if (!match) {
        throw new Error("Use demo@repomind.dev / demo1234, or create a local account on the signup screen.");
      }

      const nextUser = stripSensitive(match);
      localStorage.setItem(STORAGE_KEYS.localSession, "true");
      persistSession(nextUser);
      setUser(nextUser);
      return { user: nextUser };
    }
  };

  const signup = async (
    username: string,
    email: string,
    password: string
  ): Promise<AuthResponse> => {
    try {
      const { data } = await api.post("/auth/signup", { username, email, password });
      const nextUser = stripSensitive(data.user as LocalUser | AuthUser);
      localStorage.removeItem(STORAGE_KEYS.localSession);
      persistSession(nextUser);
      setUser(nextUser);
      return { user: nextUser };
    } catch (error: unknown) {
      if (!shouldUseLocalFallback(error)) throw error;

      const localUsers = ensureLocalUsers();
      const emailTaken = localUsers.some((account) => account.email.toLowerCase() === email.toLowerCase());
      if (emailTaken) {
        throw new Error("An account with that email already exists locally.");
      }

      const nextUser = {
        id: `local-${Date.now().toString(36)}`,
        username,
        email,
        password,
      };

      localUsers.push(nextUser);
      writeJson(STORAGE_KEYS.users, localUsers);
      const safeUser = stripSensitive(nextUser);
      localStorage.setItem(STORAGE_KEYS.localSession, "true");
      persistSession(safeUser);
      setUser(safeUser);
      return { user: safeUser };
    }
  };

  const loginWithGithub = (): void => {
    if (!GITHUB_OAUTH_ENABLED) {
      throw new Error("GitHub OAuth is not enabled yet.");
    }

    // GitHub now redirects straight back into the backend, which sets the
    // cookie itself and redirects to /dashboard — no code/state handling
    // needed on the frontend anymore.
    window.location.assign(`${getApiOrigin()}/auth/github`);
  };

  const logout = (): void => {
    void api.post("/auth/logout").catch(() => {});
    clearSession();
    localStorage.removeItem(STORAGE_KEYS.localSession);
    setUser(null);
  };

  const refreshUser = async (): Promise<AuthUser | null> => {
    try {
      const { data } = await api.get("/auth/me");
      const nextUser = stripSensitive(data as AuthUser);
      if (nextUser) {
        writeJson(STORAGE_KEYS.user, nextUser);
        setUser(nextUser);
      }
      return nextUser;
    } catch (error) {
      if (shouldUseLocalFallback(error)) {
        const cachedUser = readJson<AuthUser | null>(STORAGE_KEYS.user, null);
        if (cachedUser) {
          setUser(cachedUser);
          return cachedUser;
        }
      }

      throw error;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        signup,
        loginWithGithub,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
};