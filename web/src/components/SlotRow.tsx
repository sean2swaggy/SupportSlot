import { Link } from "react-router-dom";
import { relative } from "../domain/dates";
import { pounds } from "../domain/money";
import type { SlotView } from "../domain/types";
import { Badge, DateBlock, listingBadge } from "./ui";

export function SlotRow({ slot, to, mode }: { slot: SlotView; to: string; mode: "artist" | "promoter" }) {
  return (
    <li>
      <Link to={to} className="row">
        <DateBlock date={slot.date} muted={slot.status !== "open"} />
        <div className="row-main">
          <h3>{slot.venue}<span className="city">, {slot.city}</span></h3>
          <p className="meta">
            {mode === "artist" ? slot.promoterName : relative(slot.date)}
            <span className="dot" aria-hidden="true"> · </span>
            Set {slot.setTime}, {slot.setMinutes} min
            <span className="dot" aria-hidden="true"> · </span>
            {slot.genres.join(", ")}
          </p>
        </div>
        <div className="row-side">
          <span className="fee">{pounds(slot.feePence)}</span>
          {mode === "artist"
            ? slot.applied ? <Badge tone="pending">Requested</Badge> : <Badge tone="open">Open</Badge>
            : <span className="side-status">{listingBadge(slot.status)}{slot.status === "open" && <span className="count">{slot.applicantCount} waiting</span>}</span>}
        </div>
      </Link>
    </li>
  );
}
