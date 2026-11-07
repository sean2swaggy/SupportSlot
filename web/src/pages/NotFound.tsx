import { Link } from "react-router-dom";
import { EmptyState } from "../components/ui";

export function NotFound() {
  return <div className="page"><EmptyState title="Page not found" action={<Link className="btn btn-primary" to="/">Back to the start</Link>}>That address doesn't lead anywhere.</EmptyState></div>;
}
