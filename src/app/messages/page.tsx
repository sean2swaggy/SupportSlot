"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useStore } from "@/lib/store";
import { cn, timeAgo } from "@/lib/utils";
import { DEFAULT_FALLBACK } from "@/components/ui/AvatarUploadField";

function MessagesInner() {
  const { messageThreads, sendMessage } = useStore();
  const searchParams = useSearchParams();
  // `null` means "no explicit click yet" — falls back to the deep-linked
  // ?thread= param (e.g. from "Ask a question" on an availability request)
  // once it's hydrated into messageThreads, then to the first thread.
  // Derived during render rather than synced via an effect — the thread
  // list arrives asynchronously, so there's nothing to "reset on mount".
  const [manualSelection, setManualSelection] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const threadParam = searchParams.get("thread");
  const selectedId =
    manualSelection ??
    (threadParam && messageThreads.some((t) => t.id === threadParam) ? threadParam : messageThreads[0]?.id ?? null);
  const setSelectedId = setManualSelection;

  const selected = messageThreads.find((t) => t.id === selectedId) ?? null;

  const handleSend = () => {
    if (!selected || !draft.trim()) return;
    sendMessage(selected.id, draft.trim());
    setDraft("");
  };

  return (
    <div className="mx-auto max-w-[1200px] px-0 sm:px-6 lg:px-10 py-0 sm:py-14">
      <div className="hidden sm:block px-4 sm:px-0 pt-10 sm:pt-0">
        <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-acid mb-3">
          Inbox
        </p>
        <h1 className="font-display uppercase text-4xl sm:text-5xl leading-none tracking-tight">
          Messages
        </h1>
      </div>

      <div className="mt-0 sm:mt-10 grid grid-cols-1 sm:grid-cols-[320px_1fr] border-ink-border sm:border">
        {/* Thread list */}
        <div
          className={cn(
            "border-ink-border sm:border-r divide-y divide-ink-border sm:max-h-[70vh] sm:overflow-y-auto",
            selected ? "hidden sm:block" : "block"
          )}
        >
          {messageThreads.length === 0 ? (
            <p className="p-6 text-sm text-paper-dim">No conversations yet.</p>
          ) : (
            messageThreads.map((t) => (
              <button
                key={t.id}
                onClick={() => setSelectedId(t.id)}
                className={cn(
                  "flex w-full items-start gap-3 p-4 text-left transition-colors hover:bg-ink-raised",
                  selectedId === t.id && "bg-ink-raised"
                )}
              >
                <img src={t.withImage || DEFAULT_FALLBACK} alt="" className="h-11 w-11 shrink-0 object-cover" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm">{t.withName}</p>
                    {t.unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-acid" />}
                  </div>
                  <p className="mt-0.5 truncate font-mono text-[10px] uppercase tracking-widest text-paper-dim">
                    {t.context}
                  </p>
                  <p className="mt-1 truncate text-xs text-paper-dim">{t.lastMessage}</p>
                </div>
              </button>
            ))
          )}
        </div>

        {/* Thread view */}
        <div className={cn("flex flex-col min-h-[70vh] sm:min-h-0", !selected && "hidden sm:flex")}>
          {selected ? (
            <>
              <div className="flex items-center gap-3 border-b border-ink-border p-4">
                <button
                  onClick={() => setSelectedId(null)}
                  className="sm:hidden font-mono text-xs uppercase tracking-widest text-paper-dim mr-1"
                >
                  ←
                </button>
                <img src={selected.withImage || DEFAULT_FALLBACK} alt="" className="h-9 w-9 object-cover" />
                <div className="min-w-0">
                  <p className="text-sm truncate">{selected.withName}</p>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-paper-dim truncate">
                    {selected.context}
                  </p>
                </div>
              </div>

              <div className="flex-1 space-y-4 overflow-y-auto p-4">
                {selected.messages.map((m) => (
                  <div
                    key={m.id}
                    className={cn("flex", m.from === "me" ? "justify-end" : "justify-start")}
                  >
                    <div
                      className={cn(
                        "max-w-[75%] px-3.5 py-2.5 text-sm",
                        m.from === "me"
                          ? "bg-paper text-ink"
                          : "border border-ink-border text-paper"
                      )}
                    >
                      <p>{m.text}</p>
                      <p
                        className={cn(
                          "mt-1 font-mono text-[9px] uppercase tracking-widest",
                          m.from === "me" ? "text-ink/50" : "text-paper-dim"
                        )}
                      >
                        {timeAgo(m.time)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2 border-t border-ink-border p-4">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSend()}
                  placeholder="Write a message..."
                  className="flex-1 border border-ink-border bg-transparent px-3.5 py-2.5 text-sm outline-none focus:border-paper placeholder:text-paper-dim/60"
                />
                <button
                  onClick={handleSend}
                  className="bg-acid px-4 py-2.5 font-mono text-xs uppercase tracking-widest text-acid-ink"
                >
                  Send
                </button>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-10 text-center text-sm text-paper-dim">
              Select a conversation to view messages.
            </div>
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
