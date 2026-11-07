import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { repo } from "../data";
import { useSession } from "../hooks";

function useUnread(userId?: string) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!userId) { setN(0); return; }
    let live = true;
    const tick = () => repo.notifications(userId).then((l) => live && setN(l.filter((x) => !x.read).length), () => {});
    tick();
    const t = window.setInterval(tick, 4000);
    window.addEventListener("focus", tick);
    return () => { live = false; window.clearInterval(t); window.removeEventListener("focus", tick); };
  }, [userId]);
  return n;
}

export function Layout() {
  const { user, signOut } = useSession();
  const nav = useNavigate();
  const unread = useUnread(user?.id);
  const links: [string, string][] = user?.role === "promoter"
    ? [["/listings", "My listings"], ["/bookings", "Bookings"], ["/messages", "Messages"]]
    : user?.role === "artist"
      ? [["/slots", "Find slots"], ["/bookings", "My gigs"], ["/messages", "Messages"]]
      : [];
  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <header className="topbar">
        <Link to="/" className="wordmark" aria-label="Support Slot home">Support<span> Slot</span></Link>
        <nav className="topnav" aria-label="Main">
          {links.map(([to, label]) => <NavLink key={to} to={to}>{label}</NavLink>)}
        </nav>
        <div className="account">
          {user ? (
            <>
              <NavLink to="/notifications" className="bell" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}>
                Alerts{unread > 0 && <span className="pip">{unread > 9 ? "9+" : unread}</span>}
              </NavLink>
              <NavLink to="/profile" className="who">{user.name}</NavLink>
              <button className="btn btn-quiet small" onClick={() => { signOut(); nav("/"); }}>Sign out</button>
            </>
          ) : (
            <>
              <NavLink to="/signin" className="who">Sign in</NavLink>
              <Link to="/signup" className="btn btn-primary small">Join</Link>
            </>
          )}
        </div>
      </header>
      <main id="main"><Outlet /></main>
      {links.length > 0 && (
        <nav className="tabbar" aria-label="Main">
          {links.map(([to, label]) => <NavLink key={to} to={to}>{label}</NavLink>)}
          <NavLink to="/notifications" className="tab-alerts">Alerts{unread > 0 && <span className="pip">{unread > 9 ? "9+" : unread}</span>}</NavLink>
        </nav>
      )}
      <footer className="footer">
        <p>Support Slot connects artists and promoters. No money passes through it: the promoter pays the artist directly. This build stores everything in your browser only; accounts and messages are not shared with other devices.</p>
      </footer>
    </>
  );
}
