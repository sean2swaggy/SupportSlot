import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import type { Role, User } from "../domain/types";
import { useSession } from "../hooks";
import { EmptyState } from "./ui";

/** Renders children only for a signed-in user with the right role. */
export function Gate({ role, children }: { role?: Role; children: (u: User) => ReactNode }) {
  const { user } = useSession();
  const loc = useLocation();
  if (!user) return <div className="page"><EmptyState title="Sign in to continue" action={<div className="actions"><Link className="btn btn-primary" to="/signin" state={{ from: loc.pathname }}>Sign in</Link><Link className="btn" to="/signup">Create an account</Link></div>}>You need an account to see this page.</EmptyState></div>;
  if (role && user.role !== role) return <div className="page"><EmptyState title={`That page is for ${role}s`} action={<Link className="btn" to={user.role === "artist" ? "/slots" : "/listings"}>Back to your home</Link>}>You're signed in as {user.name}, {user.role === "artist" ? "an artist" : "a promoter"}.</EmptyState></div>;
  return <>{children(user)}</>;
}
