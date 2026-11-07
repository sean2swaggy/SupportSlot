import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { repo } from "./data";
import type { User } from "./domain/types";

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

/* ---------- demo session (no real auth yet) ---------- */
const PERSONA_KEY = "support-slot:persona";
interface Session { user: User | null; users: User[]; signInAs(id: string | null): void }
const Ctx = createContext<Session>({ user: null, users: [], signInAs: () => {} });
export const useSession = () => useContext(Ctx);

export function SessionProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [id, setId] = useState<string | null>(() => {
    try { return localStorage.getItem(PERSONA_KEY); } catch { return null; }
  });
  const load = useCallback(() => { setError(null); repo.users().then(setUsers, setError); }, []);
  useEffect(load, [load]);
  const signInAs = useCallback((next: string | null) => {
    setId(next);
    try { next ? localStorage.setItem(PERSONA_KEY, next) : localStorage.removeItem(PERSONA_KEY); } catch { /* private mode */ }
  }, []);
  if (error) return <div className="page"><div className="state state-error" role="alert"><h2>Support Slot couldn't start</h2><p>{error.message}</p><button className="btn" onClick={load}>Try again</button></div></div>;
  if (!users) return <>{fallback}</>;
  return <Ctx.Provider value={{ user: users.find((u) => u.id === id) ?? null, users, signInAs }}>{children}</Ctx.Provider>;
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
