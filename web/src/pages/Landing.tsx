import { Link } from "react-router-dom";
import { addDays, dayNum, monthShort, todayLondon, weekday } from "../domain/dates";
import { useSession } from "../hooks";

const when = (n: number) => { const d = addDays(todayLondon(), n); return `${weekday(d)} ${dayNum(d)} ${monthShort(d)}`; };

export function Landing() {
  const { user } = useSession();
  return (
    <div className="landing">
      <section className="hero page">
        <div className="hero-copy">
          <p className="eyebrow">For independent artists and promoters across the UK</p>
          <h1>Find your next stage.</h1>
          <p className="lede">A support slot is the opening spot on someone else's bill. Promoters post the ones they have; artists apply with a few honest lines about their set; the promoter picks. That's all it does.</p>
          <div className="cta-row">
            <Link className="btn btn-primary btn-lg" to="/signup?role=artist">I'm an artist</Link>
            <Link className="btn btn-lg" to="/signup?role=promoter">I'm a promoter</Link>
          </div>
          <p className="small-note">{user ? <>You're signed in as {user.name}. <Link to={user.role === "artist" ? "/slots" : "/listings"}>Continue</Link>.</> : <>Already a member? <Link to="/signin">Sign in</Link>, or <Link to="/signin">try a sample account</Link>.</>}</p>
        </div>
        <aside className="hero-ledger" aria-label="Example listings">
          <p className="ledger-title">On the board this week</p>
          <ol>
            <li><span className="l-date">{when(5)}</span><span className="l-what">The Lantern Room, Bristol<small>Folk · set 19:45 · 30 min</small></span><span className="l-fee">£80</span></li>
            <li><span className="l-date">{when(8)}</span><span className="l-what">Foundry Social, Leeds<small>Indie · set 19:40 · 30 min</small></span><span className="l-fee">£100</span></li>
            <li className="taken"><span className="l-date">{when(13)}</span><span className="l-what">Dial House, Sheffield<small>Rock · filled</small></span><span className="l-fee">£120</span></li>
          </ol>
          <p className="ledger-note">Illustration only. Browse open slots once you've joined.</p>
        </aside>
      </section>

      <section className="band">
        <div className="page how">
          <h2>How a slot gets booked</h2>
          <ol className="steps">
            <li><strong>Promoter posts a slot.</strong> Venue, date, set length, genres and the fee on offer. Added in under a minute.</li>
            <li><strong>Artist requests it.</strong> Browse by genre, city or keyword and send a short note. Withdraw any time before it's confirmed.</li>
            <li><strong>Promoter confirms one act.</strong> The slot is booked, other requests are declined, and both sides get a booking reference.</li>
            <li><strong>Plans change, honestly.</strong> Either side can cancel before the show, with a reason the other person sees. If the artist drops out, the slot reopens.</li>
          </ol>
        </div>
      </section>

      <section className="page split">
        <div>
          <h2>For artists</h2>
          <p>See the fee up front, with no guessing. Every listing shows set time, length and what the room is like, so you can say yes to the right nights.</p>
        </div>
        <div>
          <h2>For promoters</h2>
          <p>Stop answering the same DMs. Put the slot on the board, read the notes that come in, and confirm the act you want. Cancelled artist? The slot reopens itself.</p>
        </div>
        <div className="wide-note">
          <h2>What it doesn't do</h2>
          <p>Support Slot takes no fee and handles no money. The promoter pays the artist directly, as agreed on the listing.</p>
        </div>
      </section>
    </div>
  );
}
