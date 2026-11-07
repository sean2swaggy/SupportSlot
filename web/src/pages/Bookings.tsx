import { useState } from "react";
import { Link } from "react-router-dom";
import { Gate } from "../components/Gate";
import { SlotRow } from "../components/SlotRow";
import { DateBlock, EmptyState, ErrorState, Loading, bookingBadge } from "../components/ui";
import { repo } from "../data";
import { isPast, relative } from "../domain/dates";
import { pounds } from "../domain/money";
import type { BookingView, User } from "../domain/types";
import { useAsync } from "../hooks";

export function Bookings() {
  return <Gate>{(u) => <Inner user={u} />}</Gate>;
}

type Tab = "upcoming" | "pending" | "past";

function Inner({ user }: { user: User }) {
  const isArtist = user.role === "artist";
  const [tab, setTab] = useState<Tab>("upcoming");
  const { data, error, loading, reload } = useAsync(async () => {
    const [bookings, pending] = await Promise.all([repo.myBookings(user.id), isArtist ? repo.myApplications(user.id) : Promise.resolve([])]);
    return { bookings, pending };
  }, [user.id]);

  const tabs: [Tab, string, number | undefined][] = [["upcoming", "Upcoming", data?.bookings.filter(upcoming).length]];
  if (isArtist) tabs.push(["pending", "Requested", data?.pending.length]);
  tabs.push(["past", "Past and cancelled", data?.bookings.filter((b) => !upcoming(b)).length]);

  return (
    <div className="page">
      <header className="page-head"><h1>{isArtist ? "My gigs" : "Bookings"}</h1>
        <p className="sub">{isArtist ? "Shows you've been confirmed for, and requests still waiting on a promoter." : "Acts you've confirmed for your shows."}</p></header>
      <div className="tabs" role="tablist" aria-label="Bookings">
        {tabs.map(([key, label, n]) => (
          <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? "on" : ""} onClick={() => setTab(key)}>
            {label}{n !== undefined && <span className="tab-count">{n}</span>}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <Loading label="Loading bookings" /> : tab === "pending" ? (
          data!.pending.length === 0 ? <EmptyState title="No requests waiting" action={<Link className="btn btn-primary" to="/slots">Find a slot</Link>}>When you request a slot it waits here until the promoter decides.</EmptyState> : (
            <ul className="rows">{data!.pending.map((a) => <SlotRow key={a.id} mode="artist" to={`/slots/${a.listingId}`} slot={{ ...a.listing, promoterName: a.promoterName, applied: true, applicantCount: 0 }} />)}</ul>
          )
        ) : (() => {
          const list = data!.bookings.filter((b) => (tab === "upcoming") === upcoming(b));
          if (tab === "past") list.reverse();
          return list.length === 0 ? (
            tab === "upcoming"
              ? <EmptyState title="Nothing booked yet" action={<Link className="btn btn-primary" to={isArtist ? "/slots" : "/listings"}>{isArtist ? "Find a slot" : "See your listings"}</Link>}>{isArtist ? "Once a promoter confirms you, the show appears here." : "When you confirm an act for a listing, it appears here."}</EmptyState>
              : <EmptyState title="No past shows">Played and cancelled shows will be listed here.</EmptyState>
          ) : <ul className="rows">{list.map((b) => <BookingRow key={b.id} b={b} viewerIsArtist={isArtist} />)}</ul>;
        })()}
      </div>
    </div>
  );
}

const upcoming = (b: BookingView) => b.status === "confirmed" && !isPast(b.listing.date);

function BookingRow({ b, viewerIsArtist }: { b: BookingView; viewerIsArtist: boolean }) {
  const past = isPast(b.listing.date);
  return (
    <li>
      <Link to={`/bookings/${b.id}`} className="row">
        <DateBlock date={b.listing.date} muted={b.status === "cancelled" || past} />
        <div className="row-main">
          <h3>{b.listing.venue}<span className="city">, {b.listing.city}</span></h3>
          <p className="meta">{viewerIsArtist ? b.promoter.name : b.artist.name}<span className="dot" aria-hidden="true"> · </span>{b.status === "confirmed" && !past ? relative(b.listing.date) : `Ref ${b.ref}`}</p>
        </div>
        <div className="row-side"><span className="fee">{pounds(b.feePence)}</span>{bookingBadge(b.status, past)}</div>
      </Link>
    </li>
  );
}
