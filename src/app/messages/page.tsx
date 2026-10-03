"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useStore } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { MESSAGES_PER_PAGE, blockPromoter, loadEarlierMessages } from "@/lib/queries";
import { friendlyError } from "@/lib/errors";
import { cn, timeAgo } from "@/lib/utils";
import { DEFAULT_FALLBACK } from "@/components/ui/AvatarUploadField";
import ReportModal from "@/components/trust/ReportModal";
import ReasonModal from "@/components/bookings/ReasonModal";

type ThreadMessage = { id: string; from: "me" | "them"; text: string; time: string };
// A message the person has written but the server hasn't confirmed. It stays
// on screen — with Retry — until it's either saved or deliberately discarded.
type Outgoing = { tempId: string; threadId: string; text: string; status: "sending" | "failed"; error?: string };

function MessagesInner() {
  const { role, userId, messageThreads, sendMessage, markThreadRead, refreshThreads } = useStore();
  const searchParams = useSearchParams();
  const [manualSelection, setManualSelection] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [outgoing, setOutgoing] = useState<Outgoing[]>([]);
  const [older, setOlder] = useState<Record<string, ThreadMessage[]>>({});
  const [exhausted, setExhausted] = useState<Record<string, boolean>>({});
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [blockBusy, setBlockBusy] = useState(false);
  const [blockError, setBlockError] = useState<string | null>(null);

  const threadParam = searchParams.get("thread");
  const selectedId =
    manualSelection ??
    (threadParam && messageThreads.some((t) => t.id === threadParam) ? threadParam : messageThreads[0]?.id ?? null);
  const selected = messageThreads.find((t) => t.id === selectedId) ?? null;

  // Opening a conversation with unread messages marks it read (server-side).
  const selectedUnread = !!selected?.unread;
  useEffect(() => {
    if (selectedId && selectedUnread) void markThreadRead(selectedId);
  }, [selectedId, selectedUnread, markThreadRead]);

  const messages = useMemo<ThreadMessage[]>(() => {
    if (!selected) return [];
    const seen = new Set(selected.messages.map((m) => m.id));
    return [...(older[selected.id] ?? []).filter((m) => !seen.has(m.id)), ...selected.messages];
  }, [selected, older]);

  const mine = outgoing.filter((o) => o.threadId === selectedId);
  const canLoadMore = !!selected && !exhausted[selected.id] && selected.messages.length >= MESSAGES_PER_PAGE;

  const deliver = async (item: Outgoing) => {
    setOutgoing((prev) => prev.map((o) => (o.tempId === item.tempId ? { ...o, status: "sending", error: undefined } : o)));
    const result = await sendMessage(item.threadId, item.text);
    if (result.ok) setOutgoing((prev) => prev.filter((o) => o.tempId !== item.tempId));
    else setOutgoing((prev) => prev.map((o) => (o.tempId === item.tempId ? { ...o, status: "failed", error: result.error } : o)));
  };

  const handleSend = () => {
    const text = draft.trim();
    if (!selected || !text) return;
    const item: Outgoing = { tempId: crypto.randomUUID(), threadId: selected.id, text, status: "sending" };
    setOutgoing((prev) => [...prev, item]);
    setDraft("");
    void deliver(item);
  };

  const loadOlder = async () => {
    if (!selected || !userId || loadingOlder) return;
    setLoadingOlder(true);
    setOlderError(null);
    try {
      const oldest = messages[0]?.time;
      if (!oldest) return;
      const page = await loadEarlierMessages(createClient(), selected.id, oldest, userId);
      setOlder((prev) => ({ ...prev, [selected.id]: [...page, ...(prev[selected.id] ?? [])] }));
      if (page.length < MESSAGES_PER_PAGE) setExhausted((prev) => ({ ...prev, [selected.id]: true }));
    } catch (err) {
      setOlderError(friendlyError(err, "We couldn't load earlier messages."));
    } finally {
      setLoadingOlder(false);
    }
  };

  const doBlock = async () => {
    if (!selected || !userId) return;
    setBlockBusy(true);
    setBlockError(null);
    const ok = await blockPromoter(createClient(), userId, selected.withId);
    setBlockBusy(false);
    if (!ok) {
      setBlockError("We couldn't block them just now. Please try again.");
      return;
    }
    setBlockOpen(false);
    await refreshThreads();
  };

  return (
    <div className="mx-auto max-w-[1200px] px-0 sm:px-6 lg:px-10 py-0 sm:py-14">
      <div className="hidden sm:block px-4 sm:px-0 pt-10 sm:pt-0">
        <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-acid mb-3">Inbox</p>
        <h1 className="font-display uppercase text-4xl sm:text-5xl leading-none tracking-tight">Messages</h1>
      </div>

      <div className="mt-0 sm:mt-10 grid grid-cols-1 sm:grid-cols-[320px_1fr] border-ink-border sm:border">
        <div className={cn("border-ink-border sm:border-r divide-y divide-ink-border sm:max-h-[70vh] sm:overflow-y-auto", selected ? "hidden sm:block" : "block")}>
          {messageThreads.length === 0 ? (
            <p className="p-6 text-sm text-paper-dim">
              No conversations yet. {role === "artist" ? "Message a promoter from one of your applications." : "Message an applicant from your applicant list."}
            </p>
          ) : (
            messageThreads.map((t) => (
              <button
                key={t.id}
                onClick={() => setManualSelection(t.id)}
                className={cn("flex w-full items-start gap-3 p-4 text-left transition-colors hover:bg-ink-raised", selectedId === t.id && "bg-ink-raised")}
              >
                <img src={t.withImage || DEFAULT_FALLBACK} alt="" className="h-11 w-11 shrink-0 object-cover" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className={cn("truncate text-sm", t.unread && "font-medium")}>{t.withName}</p>
                    {t.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-acid" aria-label="Unread" />}
                  </div>
                  {t.context && <p className="mt-0.5 truncate font-mono text-[10px] uppercase tracking-widest text-paper-dim">{t.context}</p>}
                  <p className="mt-1 truncate text-xs text-paper-dim">{t.lastMessage}</p>
                </div>
              </button>
            ))
          )}
        </div>

        <div className={cn("flex flex-col min-h-[70vh] sm:min-h-0", !selected && "hidden sm:flex")}>
          {selected ? (
            <>
              <div className="flex items-center gap-3 border-b border-ink-border p-4">
                <button onClick={() => setManualSelection(null)} aria-label="Back to conversations" className="sm:hidden font-mono text-xs uppercase tracking-widest text-paper-dim mr-1">
                  ←
                </button>
                <img src={selected.withImage || DEFAULT_FALLBACK} alt="" className="h-9 w-9 object-cover" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm truncate">{selected.withName}</p>
                  {selected.context && <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim truncate">{selected.context}</p>}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <button type="button" onClick={() => setReportOpen(true)} className="font-mono text-[10px] uppercase tracking-widest text-paper-dim hover:text-signal hover:underline">
                    Report
                  </button>
                  {role === "artist" && (
                    <button type="button" onClick={() => { setBlockError(null); setBlockOpen(true); }} className="font-mono text-[10px] uppercase tracking-widest text-paper-dim hover:text-signal hover:underline">
                      Block
                    </button>
                  )}
                </div>
              </div>

              <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:max-h-[55vh]" aria-live="polite">
                {canLoadMore && (
                  <div className="text-center">
                    <button type="button" onClick={loadOlder} disabled={loadingOlder} className="font-mono text-[10px] uppercase tracking-widest text-paper-dim hover:text-paper disabled:opacity-50">
                      {loadingOlder ? "Loading…" : "Load earlier messages"}
                    </button>
                    {olderError && <p className="mt-1 text-xs text-signal" role="alert">{olderError}</p>}
                  </div>
                )}
                {messages.length === 0 && mine.length === 0 && <p className="text-center text-sm text-paper-dim">No messages yet — say hello.</p>}
                {messages.map((m) => (
                  <div key={m.id} className={cn("flex", m.from === "me" ? "justify-end" : "justify-start")}>
                    <div className={cn("max-w-[75%] px-3.5 py-2.5 text-sm", m.from === "me" ? "bg-paper text-ink" : "border border-ink-border text-paper")}>
                      <p className="whitespace-pre-wrap break-words">{m.text}</p>
                      <p className={cn("mt-1 font-mono text-[9px] uppercase tracking-widest", m.from === "me" ? "text-ink/50" : "text-paper-dim")}>{timeAgo(m.time)}</p>
                    </div>
                  </div>
                ))}
                {mine.map((o) => (
                  <div key={o.tempId} className="flex justify-end">
                    <div className={cn("max-w-[75%] px-3.5 py-2.5 text-sm", o.status === "failed" ? "border border-signal text-paper" : "bg-paper/70 text-ink")}>
                      <p className="whitespace-pre-wrap break-words">{o.text}</p>
                      {o.status === "sending" ? (
                        <p className="mt-1 font-mono text-[9px] uppercase tracking-widest text-ink/50">Sending…</p>
                      ) : (
                        <div className="mt-1.5" role="alert">
                          <p className="text-xs text-signal">Not sent. {o.error}</p>
                          <div className="mt-1 flex gap-3">
                            <button type="button" onClick={() => deliver(o)} className="font-mono text-[10px] uppercase tracking-widest underline">Retry</button>
                            <button type="button" onClick={() => setOutgoing((prev) => prev.filter((x) => x.tempId !== o.tempId))} className="font-mono text-[10px] uppercase tracking-widest text-paper-dim underline">Discard</button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2 border-t border-ink-border p-4">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
                  maxLength={2000}
                  aria-label="Write a message"
                  placeholder="Write a message..."
                  className="flex-1 border border-ink-border bg-transparent px-3.5 py-2.5 text-sm outline-none focus:border-paper placeholder:text-paper-dim/60"
                />
                <button onClick={handleSend} disabled={!draft.trim()} className="bg-acid px-4 py-2.5 font-mono text-xs uppercase tracking-widest text-acid-ink disabled:opacity-40">
                  Send
                </button>
              </div>

              <ReportModal open={reportOpen} onClose={() => setReportOpen(false)} contextType="message" contextId={selected.id} reportedProfileId={selected.withId || undefined} subject={`this conversation with ${selected.withName}`} />
              <ReasonModal
                open={blockOpen}
                title={`Block ${selected.withName}?`}
                body="They won't be able to message you or invite you to gigs. You can unblock them later."
                confirmLabel="Block"
                busy={blockBusy}
                error={blockError}
                onClose={() => setBlockOpen(false)}
                onConfirm={doBlock}
              />
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-10 text-center text-sm text-paper-dim">Select a conversation to view messages.</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function MessagesPage() {
  return (
    <Suspense fallback={null}>
      <MessagesInner />
    </Suspense>
  );
}
