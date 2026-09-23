"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import {
  getApplicationsForArtist,
  getApplicationsForPromoterSlots,
  getArtist,
  getMessageThreads,
  getNotifications,
  getPromoter,
} from "@/lib/queries";
import { toApplication, toSlot } from "@/lib/supabase/mappers";
import type {
  Application,
  ApplicationStatus,
  Artist,
  MessageThread,
  NotificationItem,
  Promoter,
  SupportSlot,
} from "@/lib/types";
import type { ArtistLinksOverride } from "@/lib/artist-links";

export type Role = "artist" | "promoter";

interface OnboardingArtistDetails {
  role: "artist";
  name: string;
  city: string;
  genres: string[];
  spotifyUrl: string;
  instagramUrl: string;
  bio: string;
}

interface OnboardingPromoterDetails {
  role: "promoter";
  company: string;
  city: string;
}

interface StoreShape {
  role: Role;
  currentArtistId: string;
  currentPromoterId: string;
  currentArtist: Artist | null;
  currentPromoter: Promoter | null;
  applications: Application[];
  addApplication: (app: {
    slotId: string;
    featuredTrackId: string;
    message?: string;
    matchPercent: number;
  }) => Promise<void>;
  updateApplicationStatus: (id: string, status: ApplicationStatus) => Promise<void>;
  syncApplicationStatus: (id: string, status: ApplicationStatus) => void;
  refreshApplications: () => Promise<void>;
  notifications: NotificationItem[];
  unreadNotificationCount: number;
  markNotificationRead: (id: string) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
  messageThreads: MessageThread[];
  sendMessage: (threadId: string, text: string) => Promise<void>;
  unreadMessageCount: number;
  lastMinuteAlertsEnabled: boolean;
  setLastMinuteAlertsEnabled: (v: boolean) => Promise<void>;
  // Promoter-only. Server-verified — see 0010_promoter_support_plus.sql;
  // there is no client setter for either of these two.
  isSupportPlus: boolean;
  supportPlusBillingPeriod: "monthly" | "annual";
  startSupportPlusCheckout: (period: "monthly" | "annual") => Promise<void>;
  openBillingPortal: () => Promise<void>;
  artistAvatar: string | null;
  setArtistAvatar: (v: string | null) => Promise<void>;
  promoterAvatar: string | null;
  setPromoterAvatar: (v: string | null) => Promise<void>;
  setArtistLinks: (v: ArtistLinksOverride) => Promise<void>;
  artistMonthlyListeners: number | null;
  setArtistMonthlyListeners: (v: number | null) => Promise<void>;
  addSlot: (
    slot: Omit<SupportSlot, "id" | "promoterId" | "applicantCount" | "postedAt" | "status">
  ) => Promise<SupportSlot>;
  rescheduleSlot: (
    slotId: string,
    updates: { date: string; doorsTime: string; setTime: string }
  ) => Promise<void>;
  accountEmail: string | null;
  emailVerified: boolean;
  markEmailVerified: (email: string) => void;
  hasOnboarded: boolean;
  completeOnboarding: (details: OnboardingArtistDetails | OnboardingPromoterDetails) => Promise<void>;
  hydrated: boolean;
}

const StoreContext = createContext<StoreShape | null>(null);

function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "artist";
}

function randomSuffix() {
  return Math.random().toString(36).slice(2, 6);
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => createClient(), []);

  const [user, setUser] = useState<User | null>(null);
  const [role, setRoleState] = useState<Role>("artist");
  const [hasOnboarded, setHasOnboarded] = useState(false);
  const [isSupportPlus, setIsSupportPlusState] = useState(false);
  const [supportPlusBillingPeriod, setSupportPlusBillingPeriodState] = useState<"monthly" | "annual">(
    "monthly"
  );
  const [currentArtist, setCurrentArtist] = useState<Artist | null>(null);
  const [currentPromoter, setCurrentPromoter] = useState<Promoter | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [messageThreads, setMessageThreads] = useState<MessageThread[]>([]);
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [emailVerified, setEmailVerified] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const currentArtistId = role === "artist" && user ? user.id : "";
  const currentPromoterId = role === "promoter" && user ? user.id : "";

  // Loads everything for the signed-in user: profile, role-specific catalog
  // row, and role-specific interactive data (applications, notifications,
  // messages, wallet). Runs once per sign-in and again after mutations that
  // change data another part of the app also needs to see fresh.
  const loadForUser = useCallback(
    async (authUser: User) => {
      setAccountEmail(authUser.email ?? null);
      setEmailVerified(!!authUser.email_confirmed_at);

      const { data: profile } = await supabase
        .from("profiles")
        .select("role, has_onboarded, is_support_plus, support_plus_billing_period")
        .eq("id", authUser.id)
        .maybeSingle();

      const resolvedRole = (profile?.role as Role | undefined) ?? "artist";
      setRoleState(resolvedRole);
      setHasOnboarded(profile?.has_onboarded ?? false);
      setIsSupportPlusState(profile?.is_support_plus ?? false);
      setSupportPlusBillingPeriodState(
        (profile?.support_plus_billing_period as "monthly" | "annual" | null) ?? "monthly"
      );

      if (!profile?.has_onboarded) {
        // Nothing else to load yet — the artist/promoter row doesn't exist
        // until onboarding finishes.
        setHydrated(true);
        return;
      }

      if (resolvedRole === "artist") {
        const [artist, apps, notifs, threads] = await Promise.all([
          getArtist(supabase, authUser.id),
          getApplicationsForArtist(supabase, authUser.id),
          getNotifications(supabase, authUser.id),
          getMessageThreads(supabase, { role: "artist", id: authUser.id }),
        ]);
        setCurrentArtist(artist);
        setCurrentPromoter(null);
        setApplications(apps);
        setNotifications(notifs);
        setMessageThreads(threads);
      } else {
        const [promoter, apps, notifs, threads] = await Promise.all([
          getPromoter(supabase, authUser.id),
          getApplicationsForPromoterSlots(supabase, authUser.id),
          getNotifications(supabase, authUser.id),
          getMessageThreads(supabase, { role: "promoter", id: authUser.id }),
        ]);
        setCurrentPromoter(promoter);
        setCurrentArtist(null);
        setApplications(
          apps.map((a) => {
            const { artist, ...app } = a;
            void artist;
            return app;
          })
        );
        setNotifications(notifs);
        setMessageThreads(threads);
      }

      setHydrated(true);
    },
    [supabase]
  );

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      if (data.user) {
        setUser(data.user);
        loadForUser(data.user);
      } else {
        setHydrated(true);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      setUser(session?.user ?? null);
      if (session?.user) {
        loadForUser(session.user);
      } else {
        setCurrentArtist(null);
        setCurrentPromoter(null);
        setApplications([]);
        setNotifications([]);
        setMessageThreads([]);
        setHasOnboarded(false);
        setHydrated(true);
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addApplication: StoreShape["addApplication"] = useCallback(
    async (app) => {
      if (!user) return;
      const { data, error } = await supabase
        .from("applications")
        .insert({
          slot_id: app.slotId,
          artist_id: user.id,
          featured_track_id: app.featuredTrackId || null,
          message: app.message,
          match_percent: app.matchPercent,
        })
        .select(
          "id, slot_id, artist_id, status, featured_track_id, message, match_percent, submitted_at"
        )
        .single();
      if (error || !data) return;
      setApplications((prev) => [toApplication(data), ...prev]);
    },
    [supabase, user]
  );

  const updateApplicationStatus: StoreShape["updateApplicationStatus"] = useCallback(
    async (id, status) => {
      const { data, error } = await supabase
        .from("applications")
        .update({ status })
        .eq("id", id)
        .select(
          "id, slot_id, artist_id, status, featured_track_id, message, match_percent, submitted_at"
        )
        .single();
      if (error || !data) return;
      const mapped = toApplication(data);
      setApplications((prev) => prev.map((a) => (a.id === id ? mapped : a)));
    },
    [supabase]
  );

  // For applications created outside the normal addApplication path — e.g.
  // accepting a gig invitation writes the row directly (see
  // respondToGigInvitation in lib/queries.ts) so it never passes through
  // addApplication's own setApplications call. Re-fetches instead of
  // trying to splice one row in, since a promoter's `applications` list is
  // actually a join across all their slots, not a single insert response.
  const refreshApplications: StoreShape["refreshApplications"] = useCallback(async () => {
    if (!user) return;
    if (role === "artist") {
      const apps = await getApplicationsForArtist(supabase, user.id);
      setApplications(apps);
    } else {
      const apps = await getApplicationsForPromoterSlots(supabase, user.id);
      setApplications(
        apps.map((a) => {
          const { artist, ...app } = a;
          void artist;
          return app;
        })
      );
    }
  }, [supabase, user, role]);

  // Local-only state sync — no DB write. The "booked" transition is
  // deliberately blocked from direct client writes (see
  // 0008_real_payments.sql); the server already wrote it after verifying
  // payment (src/app/api/stripe/payments/confirm/route.ts), so the client
  // just needs to reflect that here.
  const syncApplicationStatus: StoreShape["syncApplicationStatus"] = useCallback((id, status) => {
    setApplications((prev) => prev.map((a) => (a.id === id ? { ...a, status } : a)));
  }, []);

  const markNotificationRead: StoreShape["markNotificationRead"] = useCallback(
    async (id) => {
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
      await supabase.from("notifications").update({ read: true }).eq("id", id);
    },
    [supabase]
  );

  const markAllNotificationsRead: StoreShape["markAllNotificationsRead"] = useCallback(async () => {
    if (!user) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    await supabase.from("notifications").update({ read: true }).eq("profile_id", user.id).eq("read", false);
  }, [supabase, user]);

  const sendMessage: StoreShape["sendMessage"] = useCallback(
    async (threadId, text) => {
      if (!user) return;
      const { error } = await supabase.from("messages").insert({
        thread_id: threadId,
        sender_id: user.id,
        text,
      });
      if (error) return;
      const readColumn = role === "artist" ? "artist_last_read_at" : "promoter_last_read_at";
      await supabase
        .from("message_threads")
        .update({ [readColumn]: new Date().toISOString() })
        .eq("id", threadId);
      const threads = await getMessageThreads(supabase, { role, id: user.id });
      setMessageThreads(threads);
    },
    [supabase, user, role]
  );

  const setLastMinuteAlertsEnabled: StoreShape["setLastMinuteAlertsEnabled"] = useCallback(
    async (v) => {
      if (!user || !currentArtist) return;
      setCurrentArtist({ ...currentArtist, lastMinuteAlerts: v });
      await supabase.from("artists").update({ last_minute_alerts: v }).eq("id", user.id);
    },
    [supabase, user, currentArtist]
  );

  // Support+ is a promoter-only subscription now, and — critically —
  // is_support_plus is no longer something a client can just write (see
  // 0010_promoter_support_plus.sql's trigger). These two call real Stripe
  // endpoints and redirect; the flag itself only ever changes via the
  // checkout return route or the subscription webhook, both using the
  // service-role key.
  const startSupportPlusCheckout: StoreShape["startSupportPlusCheckout"] = useCallback(
    async (period) => {
      const res = await fetch("/api/stripe/subscriptions/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period }),
      });
      const body = await res.json();
      if (!res.ok || !body.url) throw new Error(body.error ?? "Couldn't start checkout.");
      window.location.href = body.url;
    },
    []
  );

  const openBillingPortal: StoreShape["openBillingPortal"] = useCallback(async () => {
    const res = await fetch("/api/stripe/subscriptions/portal", { method: "POST" });
    const body = await res.json();
    if (!res.ok || !body.url) throw new Error(body.error ?? "Couldn't open billing portal.");
    window.location.href = body.url;
  }, []);

  const setArtistAvatar: StoreShape["setArtistAvatar"] = useCallback(
    async (v) => {
      if (!user || !currentArtist) return;
      setCurrentArtist({ ...currentArtist, image: v ?? "" });
      await supabase.from("artists").update({ image_url: v }).eq("id", user.id);
    },
    [supabase, user, currentArtist]
  );

  const setPromoterAvatar: StoreShape["setPromoterAvatar"] = useCallback(
    async (v) => {
      if (!user || !currentPromoter) return;
      setCurrentPromoter({ ...currentPromoter, avatar: v ?? "" });
      await supabase.from("promoters").update({ avatar_url: v }).eq("id", user.id);
    },
    [supabase, user, currentPromoter]
  );

  const setArtistLinks: StoreShape["setArtistLinks"] = useCallback(
    async (links) => {
      if (!user || !currentArtist) return;
      const updates = {
        spotify_url: links.spotifyUrl?.trim() ?? "",
        instagram_url: links.instagramUrl?.trim() ?? "",
        tiktok_url: links.tiktokUrl?.trim() ?? "",
        soundcloud_url: links.soundcloudUrl?.trim() || null,
        bandcamp_url: links.bandcampUrl?.trim() || null,
        youtube_url: links.youtubeUrl?.trim() || null,
        website_url: links.websiteUrl?.trim() || null,
      };
      setCurrentArtist({
        ...currentArtist,
        spotifyUrl: updates.spotify_url,
        instagramUrl: updates.instagram_url,
        tiktokUrl: updates.tiktok_url,
        soundcloudUrl: updates.soundcloud_url ?? undefined,
        bandcampUrl: updates.bandcamp_url ?? undefined,
        youtubeUrl: updates.youtube_url ?? undefined,
        websiteUrl: updates.website_url ?? undefined,
      });
      await supabase.from("artists").update(updates).eq("id", user.id);
    },
    [supabase, user, currentArtist]
  );

  const setArtistMonthlyListeners: StoreShape["setArtistMonthlyListeners"] = useCallback(
    async (v) => {
      if (!user || !currentArtist) return;
      setCurrentArtist({ ...currentArtist, monthlyListeners: v ?? 0 });
      await supabase.from("artists").update({ monthly_listeners: v }).eq("id", user.id);
    },
    [supabase, user, currentArtist]
  );

  const addSlot: StoreShape["addSlot"] = useCallback(
    async (slot) => {
      if (!user) throw new Error("Not signed in.");
      const { data, error } = await supabase
        .from("slots")
        .insert({
          promoter_id: user.id,
          venue_id: slot.venueId,
          headliner: slot.headliner,
          headliner_image_url: slot.headlinerImage || null,
          artist_photo_url: slot.artistPhoto || null,
          city: slot.city,
          date: slot.date,
          doors_time: slot.doorsTime,
          set_time: slot.setTime,
          performance_length_mins: slot.performanceLengthMins,
          genres: slot.genres,
          expected_attendance: slot.expectedAttendance,
          support_fee: slot.supportFee,
          travel_contribution: slot.travelContribution,
          booking_fee: slot.bookingFee,
          requirements: slot.requirements,
          application_deadline: slot.applicationDeadline,
          is_urgent: slot.isUrgent,
          artist_size_fit: slot.artistSizeFit,
          description: slot.description,
        })
        .select(
          "id, promoter_id, venue_id, headliner, headliner_image_url, artist_photo_url, city, date, doors_time, set_time, performance_length_mins, genres, expected_attendance, support_fee, travel_contribution, booking_fee, requirements, application_deadline, applicant_count, is_urgent, status, artist_size_fit, description, rescheduled_at, posted_at"
        )
        .single();
      if (error || !data) throw new Error(error?.message ?? "Couldn't post that slot.");
      return toSlot(data);
    },
    [supabase, user]
  );

  const rescheduleSlot: StoreShape["rescheduleSlot"] = useCallback(
    async (slotId, updates) => {
      const { data, error } = await supabase
        .from("slots")
        .update({
          date: updates.date,
          doors_time: updates.doorsTime,
          set_time: updates.setTime,
          rescheduled_at: new Date().toISOString(),
        })
        .eq("id", slotId)
        .select("id")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error("Couldn't reschedule that show — you may not have permission.");
    },
    [supabase]
  );

  const markEmailVerified: StoreShape["markEmailVerified"] = useCallback((email) => {
    // Verification itself already happened against Supabase Auth (see
    // EmailVerifyPanel) — this just reflects that into local state.
    setAccountEmail(email);
    setEmailVerified(true);
  }, []);

  const completeOnboarding: StoreShape["completeOnboarding"] = useCallback(
    async (details) => {
      if (!user) throw new Error("Not signed in.");

      if (details.role === "artist") {
        const base = slugify(details.name);
        let handle = base;
        for (let attempt = 0; attempt < 5; attempt++) {
          const { data: existing } = await supabase
            .from("artists")
            .select("id")
            .eq("handle", handle)
            .maybeSingle();
          if (!existing) break;
          handle = `${base}-${randomSuffix()}`;
        }

        const { error } = await supabase.from("artists").insert({
          id: user.id,
          handle,
          name: details.name,
          location: details.city,
          genres: details.genres,
          spotify_url: details.spotifyUrl,
          instagram_url: details.instagramUrl,
          bio: details.bio,
          image_url: currentArtist?.image || null,
        });
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase.from("promoters").insert({
          id: user.id,
          name: details.company,
          company: details.company,
          location: details.city,
          avatar_url: currentPromoter?.avatar || null,
        });
        if (error) throw new Error(error.message);
      }

      await supabase.from("profiles").update({ has_onboarded: true }).eq("id", user.id);
      setHasOnboarded(true);
      await loadForUser(user);
    },
    [supabase, user, currentArtist, currentPromoter, loadForUser]
  );

  const unreadNotificationCount = notifications.filter((n) => !n.read).length;
  const unreadMessageCount = messageThreads.filter((t) => t.unread).length;

  const value = useMemo<StoreShape>(
    () => ({
      role,
      currentArtistId,
      currentPromoterId,
      currentArtist,
      currentPromoter,
      applications,
      addApplication,
      updateApplicationStatus,
      syncApplicationStatus,
      refreshApplications,
      notifications,
      unreadNotificationCount,
      markNotificationRead,
      markAllNotificationsRead,
      messageThreads,
      sendMessage,
      unreadMessageCount,
      lastMinuteAlertsEnabled: currentArtist?.lastMinuteAlerts ?? false,
      setLastMinuteAlertsEnabled,
      isSupportPlus,
      supportPlusBillingPeriod,
      startSupportPlusCheckout,
      openBillingPortal,
      artistAvatar: currentArtist?.image || null,
      setArtistAvatar,
      promoterAvatar: currentPromoter?.avatar || null,
      setPromoterAvatar,
      setArtistLinks,
      artistMonthlyListeners: currentArtist?.monthlyListeners ?? null,
      setArtistMonthlyListeners,
      addSlot,
      rescheduleSlot,
      accountEmail,
      emailVerified,
      markEmailVerified,
      hasOnboarded,
      completeOnboarding,
      hydrated,
    }),
    [
      role,
      currentArtistId,
      currentPromoterId,
      currentArtist,
      currentPromoter,
      applications,
      addApplication,
      updateApplicationStatus,
      syncApplicationStatus,
      refreshApplications,
      notifications,
      unreadNotificationCount,
      markNotificationRead,
      markAllNotificationsRead,
      messageThreads,
      sendMessage,
      unreadMessageCount,
      setLastMinuteAlertsEnabled,
      isSupportPlus,
      supportPlusBillingPeriod,
      startSupportPlusCheckout,
      openBillingPortal,
      setArtistAvatar,
      setPromoterAvatar,
      setArtistLinks,
      setArtistMonthlyListeners,
      addSlot,
      rescheduleSlot,
      accountEmail,
      emailVerified,
      markEmailVerified,
      hasOnboarded,
      completeOnboarding,
      hydrated,
    ]
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
