import { NavLink, Outlet, Link, useNavigate } from "react-router-dom";
import { useSession } from "../hooks";

export function Layout() {
  const { user, users, signInAs } = useSession();
  const nav = useNavigate();
  const links = user?.role === "promoter"
    ? [["/listings", "My listings"], ["/bookings", "Bookings"]]
    : user?.role === "artist"
      ? [["/slots", "Find slots"], ["/bookings", "My gigs"]]
      : [];
  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <header className="topbar">
        <Link to="/" className="wordmark" aria-label="Support Slot home">Support<span> Slot</span></Link>
        <nav className="topnav" aria-label="Main">
          {links.map(([to, label]) => <NavLink key={to} to={to}>{label}</NavLink>)}
        </nav>
        <div className="persona">
          <label htmlFor="persona" className="sr-only">Demo profile</label>
          <select id="persona" value={user?.id ?? ""} onChange={(e) => {
            const v = e.target.value || null;
            signInAs(v);
            const u = users.find((x) => x.id === v);
            nav(u ? (u.role === "artist" ? "/slots" : "/listings") : "/");
          }}>
            <option value="">Not signed in</option>
            <optgroup label="Artists">{users.filter((u) => u.role === "artist").map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</optgroup>
            <optgroup label="Promoters">{users.filter((u) => u.role === "promoter").map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</optgroup>
          </select>
        </div>
      </header>
      <main id="main"><Outlet /></main>
      {links.length > 0 && (
        <nav className="tabbar" aria-label="Main">
          {links.map(([to, label]) => <NavLink key={to} to={to}>{label}</NavLink>)}
        </nav>
      )}
      <footer className="footer">
        <p>Support Slot connects artists and promoters. No money passes through it: the promoter pays the artist directly. Demo data is fictional and stored in this browser only.</p>
      </footer>
    </>
  );
}
