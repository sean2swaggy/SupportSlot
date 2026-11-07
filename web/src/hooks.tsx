import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { repo } from "./data";
import type { NewAccount, User } from "./domain/types";

/* ---------- async loading ---------- */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: Error; loading: boolean }>({ loading: true });
  const run = useRef(0);
  const load = useCallback(() => {
    const id = ++run.current;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    fn().then(
      (data) => id === run.current && setState({ data, loading: false }),
      (error: Error) => id === run.current && setState({ error, loading: false }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(load, [load]);
  return { ...state, reload: load };
}

/* ---------- session (local demo accounts) ---------- */
const SESSION_KEY = "support-slot:session";
interface Session {
  user: User | null;
  signIn(email: string, password: string): Promise<User>;
  signUp(a: NewAccount): Promise<User>;
  signOut(): void;
  setUser(u: User): void;
}
const Ctx = createContext<Session>({ user: null, signIn: async () => { throw new Error("no session"); }, signUp: async () => { throw new Error("no session"); }, signOut: () => {}, setUser: () => {} });
export const useSession = () => useContext(Ctx);

const remember = (id: string | null) => {
  try { id ? localStorage.setItem(SESSION_KEY, id) : localStorage.removeItem(SESSION_KEY); } catch { /* private mode */ }
};

export function SessionProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const [state, setState] = useState<{ ready: boolean; user: User | null }>({ ready: false, user: null });
  useEffect(() => {
    let id: string | null = null;
    try { id = localStorage.getItem(SESSION_KEY); } catch { /* ignore */ }
    if (!id) { setState({ ready: true, user: null }); return; }
    repo.user(id).then((user) => setState({ ready: true, user }), () => setState({ ready: true, user: null }));
  }, []);
  const value: Session = {
    user: state.user,
    signIn: async (email, password) => { const user = await repo.signIn(email, password); remember(user.id); setState({ ready: true, user }); return user; },
    signUp: async (a) => { const user = await repo.signUp(a); remember(user.id); setState({ ready: true, user }); return user; },
    signOut: () => { remember(null); setState({ ready: true, user: null }); },
    setUser: (user) => setState({ ready: true, user }),
  };
  if (!state.ready) return <>{fallback}</>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/* ---------- notices ---------- */
const NoticeCtx = createContext<(msg: string) => void>(() => {});
export const useNotice = () => useContext(NoticeCtx);
export function NoticeProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<number>();
  const show = useCallback((m: string) => {
    setMsg(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), 5000);
  }, []);
  return (
    <NoticeCtx.Provider value={show}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {msg && <div className="toast">{msg}</div>}
      </div>
    </NoticeCtx.Provider>
  );
}
