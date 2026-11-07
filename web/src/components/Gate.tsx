import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Role, User } from "../domain/types";
import { useSession } from "../hooks";
import { EmptyState } from "./ui";

/** Renders children only for a signed-in user with the right role. */
export function Gate({ role, children }: { role?: Role; children: (u: User) => ReactNode }) {
  const { user } = useSession();
  if (!user) return <div className="page"><EmptyState title="Choose a demo profile" action={<Link className="btn btn-primary" to="/">Go to the start</Link>}>This is a demo without real accounts. Pick an artist or a promoter to look around as.</EmptyState></div>;
  if (role && user.role !== role) return <div className="page"><EmptyState title={`That page is for ${role}s`} action={<Link className="btn" to={user.role === "artist" ? "/slots" : "/listings"}>Back to your home</Link>}>You're signed in as {user.name}, a {user.role}. Use the profile menu at the top to switch.</EmptyState></div>;
  return <>{children(user)}</>;
}
