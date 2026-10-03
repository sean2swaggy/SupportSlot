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
  getArtistBookings,
  getMessageThreads,
  getNotifications,
  getPromoter,
  getPromoterBookings,
  SLOT_WITH_VENUE_COLUMNS,
} from "@/lib/queries";
import { toSlot, type SlotRow } from "@/lib/supabase/mappers";
import {
  applyToSlot,
  getSavedSlotIds,
  markThreadRead as markThreadReadAction,
  saveSlot,
  sendMessageRow,
  setEmailNotifications,
  unsaveSlot,
} from "@/lib/actions";
import { fail, ok, type Result } from "@/lib/result";
import { friendlyError } from "@/lib/errors";
import type {
  Application,
  Artist,
  Booking,
  MessageThread,
  NotificationItem,
  Promoter,
  SupportSlot,
} from "@/lib/types";
import type { ArtistLinksOverride } from "@/lib/artist-links";

export type Role = "artist" | "promoter";

interface OnboardingArtistDetails {
  role: "artist";
  username: string;
  name: string;
  city: string;
  genres: string[];
  spotifyUrl: string;
  instagramUrl: string;
  bio: string;
}

interface OnboardingPromoterDetails {
  role: "promoter";
  username: string;
  company: string;
  city: string;
}

interface StoreShape {
  role: Role;
  currentArtistId: string;
  currentPromoterId: string;
  currentArtist: Artist | null;
  currentPromoter: Promoter | null;
  signedIn: boolean;
  userId: string | null;
  // Set when the first load of the signed-in user's data failed — screens
  // show a retry rather than a misleading empty state.
  loadError: string | null;
  reload: () => Promise<void>;
  suspended: boolean;
  adminRole: "moderator" | "admin" | null;
  applications: Application[];
  bookings: Booking[];
  apply: (input: { slotId: string; featuredTrackId?: string; message?: string }) => Promise<Result<{ id: string }>>;
  // Re-reads applications, bookings and notifications from the database after
  // any change made through a SQL function, so every screen shows the truth.
  refreshApplications: () => Promise<void>;
  savedSlotIds: string[];
  toggleSavedSlot: (slotId: string) => Promise<Result<boolean>>;
  emailNotifications: boolean;
  setEmailNotificationsPref: (enabled: boolean) => Promise<Result<void>>;
  notifications: NotificationItem[];
  unreadNotificationCount: number;
  markNotificationRead: (id: string) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
  messageThreads: MessageThread[];
  sendMessage: (threadId: string, text: string) => Promise<Result<void>>;
  markThreadRead: (threadId: string) => Promise<void>;
  refreshThreads: () => Promise<void>;
  unreadMessageCount: number;
  lastMinuteAlertsEnabled: boolean;
  setLastMinuteAlertsEnabled: (v: boolean) => Promise<Result<void>>;
  // Promoter-only. Server-verified — see 0010_promoter_support_plus.sql;
  // there is no client setter for either of these two.
  isSupportPlus: boolean;
  supportPlusBillingPeriod: "monthly" | "annual";
  supportPlusStatus: string | null;
  supportPlusPeriodEnd: string | null;
  supportPlusCancelAtPeriodEnd: boolean;
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
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [savedSlotIds, setSavedSlotIds] = useState<string[]>([]);
  const [emailNotifications, setEmailNotificationsState] = useState(true);
  const [suspended, setSuspended] = useState(false);
  const [adminRole, setAdminRole] = useState<"moderator" | "admin" | null>(null);
  const [supportPlusStatus, setSupportPlusStatus] = useState<string | null>(null);
  const [supportPlusPeriodEnd, setSupportPlusPeriodEnd] = useState<string | null>(null);
  const [supportPlusCancelAtPeriodEnd, setSupportPlusCancelAtPeriodEnd] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
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
        .select(
          "role, has_onboarded, is_support_plus, support_plus_billing_period, support_plus_status, support_plus_current_period_end, support_plus_cancel_at_period_end, email_notifications, suspended_at, admin_role"
        )
        .eq("id", authUser.id)
        .maybeSingle();

      const resolvedRole = (profile?.role as Role | undefined) ?? "artist";
      setRoleState(resolvedRole);
      setHasOnboarded(profile?.has_onboarded ?? false);
      setIsSupportPlusState(profile?.is_support_plus ?? false);
      setSupportPlusBillingPeriodState(
        (profile?.support_plus_billing_period as "monthly" | "annual" | null) ?? "monthly"
      );
      setSupportPlusStatus((profile?.support_plus_status as string | null) ?? null);
      setSupportPlusPeriodEnd((profile?.support_plus_current_period_end as string | null) ?? null);
      setSupportPlusCancelAtPeriodEnd(!!profile?.support_plus_cancel_at_period_end);
      setEmailNotificationsState(profile?.email_notifications ?? true);
      setSuspended(!!profile?.suspended_at);
      setAdminRole((profile?.admin_role as "moderator" | "admin" | null) ?? null);

      if (!profile?.has_onboarded) {
        // Nothing else to load yet — the artist/promoter row doesn't exist
        // until onboarding finishes.
        setHydrated(true);
        return;
      }

      if (resolvedRole === "artist") {
        const [artist, apps, notifs, threads, bookingsResult, saved] = await Promise.all([
          getArtist(supabase, authUser.id),
          getApplicationsForArtist(supabase, authUser.id),
          getNotifications(supabase, authUser.id),
          getMessageThreads(supabase, { role: "artist", id: authUser.id }),
          getArtistBookings(supabase, authUser.id),
          getSavedSlotIds(supabase, authUser.id),
        ]);
        if (!artist) throw new Error("profile_load_failed");
        setCurrentArtist(artist);
        setCurrentPromoter(null);
        setApplications(apps);
        setBookings(bookingsResult.ok ? bookingsResult.data : []);
        setSavedSlotIds(saved);
        setNotifications(notifs);
        setMessageThreads(threads);
      } else {
        const [promoter, apps, notifs, threads, bookingsResult, saved] = await Promise.all([
          getPromoter(supabase, authUser.id),
          getApplicationsForPromoterSlots(supabase, authUser.id),
          getNotifications(supabase, authUser.id),
          getMessageThreads(supabase, { role: "promoter", id: authUser.id }),
          getPromoterBookings(supabase, authUser.id),
          getSavedSlotIds(supabase, authUser.id),
        ]);
        if (!promoter) throw new Error("profile_load_failed");
        setBookings(bookingsResult.ok ? bookingsResult.data : []);
        setSavedSlotIds(saved);
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

      setLoadError(null);
      setHydrated(true);
    },
    [supabase]
  );

  // loadForUser can fail (network, a policy error). Never leave the app on
  // the splash screen or quietly show empty data: record the failure so
  // screens can offer a retry.
  const runLoad = useCallback(
    async (authUser: User) => {
      try {
        await loadForUser(authUser);
      } catch (err) {
        console.error("Couldn't load account data", err);
        setLoadError(friendlyError(err, "We couldn't load your account just now."));
        setHydrated(true);
      }
    },
    [loadForUser]
  );

  const reload = useCallback(async () => {
    if (user) {
      setLoadError(null);
      await runLoad(user);
    }
  }, [user, runLoad]);

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      if (data.user) {
        setUser(data.user);
        runLoad(data.user);
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
        runLoad(session.user);
      } else {
        setCurrentArtist(null);
        setCurrentPromoter(null);
        setBookings([]);
        setSavedSlotIds([]);
        setSuspended(false);
        setAdminRole(null);
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

  // Re-reads everything a state change can touch. Called after every action
  // that goes through a SQL function (and by the live refresh below).
  const refreshApplications: StoreShape["refreshApplications"] = useCallback(async () => {
    if (!user) return;
    if (role === "artist") {
      const [apps, bookingsResult, notifs] = await Promise.all([
        getApplicationsForArtist(supabase, user.id),
        getArtistBookings(supabase, user.id),
        getNotifications(supabase, user.id),
      ]);
      setApplications(apps);
      if (bookingsResult.ok) setBookings(bookingsResult.data);
      setNotifications(notifs);
    } else {
      const [apps, bookingsResult, notifs] = await Promise.all([
        getApplicationsForPromoterSlots(supabase, user.id),
        getPromoterBookings(supabase, user.id),
        getNotifications(supabase, user.id),
      ]);
      setApplications(
        apps.map((a) => {
          const { artist, ...app } = a;
          void artist;
          return app;
        })
      );
      if (bookingsResult.ok) setBookings(bookingsResult.data);
      setNotifications(notifs);
    }
  }, [supabase, user, role]);

  const apply: StoreShape["apply"] = useCallback(
    async (input) => {
      if (!user) return fail("not_authenticated");
      const result = await applyToSlot(supabase, {
        slotId: input.slotId,
        artistId: user.id,
        featuredTrackId: input.featuredTrackId,
        message: input.message,
      });
      // Only refresh on success; on failure the caller shows the error and
      // nothing local pretends the application exists.
      if (result.ok) await refreshApplications();
      return result;
    },
    [supabase, user, refreshApplications]
  );

  const toggleSavedSlot: StoreShape["toggleSavedSlot"] = useCallback(
    async (slotId) => {
      if (!user) return fail("not_authenticated");
      const wasSaved = savedSlotIds.includes(slotId);
      const result = wasSaved ? await unsaveSlot(supabase, user.id, slotId) : await saveSlot(supabase, user.id, slotId);
      if (!result.ok) return result;
      setSavedSlotIds((prev) => (wasSaved ? prev.filter((id) => id !== slotId) : [...prev, slotId]));
      return ok(!wasSaved);
    },
    [supabase, user, savedSlotIds]
  );

  const setEmailNotificationsPref: StoreShape["setEmailNotificationsPref"] = useCallback(
    async (enabled) => {
      if (!user) return fail("not_authenticated");
      const result = await setEmailNotifications(supabase, user.id, enabled);
      if (result.ok) setEmailNotificationsState(enabled);
      return result;
    },
    [supabase, user]
  );

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

  const refreshThreads: StoreShape["refreshThreads"] = useCallback(async () => {
    if (!user) return;
    setMessageThreads(await getMessageThreads(supabase, { role, id: user.id }));
  }, [supabase, user, role]);

  // Returns the outcome: the screen keeps the draft and offers Retry on
  // failure, instead of clearing the box as if the message had gone.
  const sendMessage: StoreShape["sendMessage"] = useCallback(
    async (threadId, text) => {
      if (!user) return fail("not_authenticated");
      const result = await sendMessageRow(supabase, { threadId, senderId: user.id, text });
      if (!result.ok) return result;
      await markThreadReadAction(supabase, threadId);
      await refreshThreads();
      return ok();
    },
    [supabase, user, refreshThreads]
  );

  const markThreadRead: StoreShape["markThreadRead"] = useCallback(
    async (threadId) => {
      await markThreadReadAction(supabase, threadId);
      setMessageThreads((prev) => prev.map((t) => (t.id === threadId ? { ...t, unread: false } : t)));
      setNotifications((prev) => prev.map((n) => (n.type === "message" && n.href === `/messages?thread=${threadId}` ? { ...n, read: true } : n)));
    },
    [supabase]
  );

  const setLastMinuteAlertsEnabled: StoreShape["setLastMinuteAlertsEnabled"] = useCallback(
    async (v) => {
      if (!user || !currentArtist) return fail("not_authenticated");
      const { error } = await supabase.from("artists").update({ last_minute_alerts: v }).eq("id", user.id);
      if (error) return fail(error, "We couldn't save that setting. Please try again.");
      setCurrentArtist({ ...currentArtist, lastMinuteAlerts: v });
      return ok();
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
        .select(SLOT_WITH_VENUE_COLUMNS)
        .single();
      if (error || !data) throw new Error(friendlyError(error, "Couldn't post that listing."));
      return toSlot(data as unknown as SlotRow);
    },
    [supabase, user]
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

      // Claim the username first, before creating the artist/promoter row —
      // if this fails, nothing else has been written yet, so a retry with a
      // different username doesn't hit a duplicate-row error on the second
      // insert below (both artists.id and promoters.id are the user's own
      // id, so re-inserting the same row on retry would otherwise fail too).
      const { error: usernameError } = await supabase
        .from("profiles")
        .update({ username: details.username })
        .eq("id", user.id);
      if (usernameError) {
        // 23505 = unique_violation — the live availability check already
        // caught this in the common case, but someone else could have taken
        // it in the gap between checking and submitting.
        if (usernameError.code === "23505") {
          throw new Error("That username was just taken — try another.");
        }
        throw new Error(friendlyError(usernameError, "We couldn't save that username."));
      }

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
        if (error) throw new Error(friendlyError(error, "We couldn't create your artist profile."));
      } else {
        const { error } = await supabase.from("promoters").insert({
          id: user.id,
          name: details.company,
          company: details.company,
          location: details.city,
          avatar_url: currentPromoter?.avatar || null,
        });
        if (error) throw new Error(friendlyError(error, "We couldn't create your promoter profile."));
      }

      const { error: finishError } = await supabase.from("profiles").update({ has_onboarded: true }).eq("id", user.id);
      if (finishError) throw new Error(friendlyError(finishError, "We couldn't finish setting up your account."));
      setHasOnboarded(true);
      await loadForUser(user);
    },
    [supabase, user, currentArtist, currentPromoter, loadForUser]
  );

  // Keep unread counts, application states and bookings current without a
  // manual refresh: re-read when the tab regains focus and every 45 seconds
  // while it's visible. (A message sent by someone else, or an offer, shows
  // up here.) Skips while hidden so background tabs don't hammer the API.
  useEffect(() => {
    if (!user || !hasOnboarded) return;
    const tick = () => {
      if (document.visibilityState === "visible") {
        refreshApplications().catch(() => undefined);
        refreshThreads().catch(() => undefined);
      }
    };
    const id = window.setInterval(tick, 45_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [user, hasOnboarded, refreshApplications, refreshThreads]);

  const unreadNotificationCount = notifications.filter((n) => !n.read).length;
  const unreadMessageCount = messageThreads.filter((t) => t.unread).length;

  const value = useMemo<StoreShape>(
    () => ({
      role,
      currentArtistId,
      currentPromoterId,
      currentArtist,
      currentPromoter,
      signedIn: !!user,
      userId: user?.id ?? null,
      loadError,
      reload,
      suspended,
      adminRole,
      applications,
      bookings,
      apply,
      refreshApplications,
      savedSlotIds,
      toggleSavedSlot,
      emailNotifications,
      setEmailNotificationsPref,
      notifications,
      unreadNotificationCount,
      markNotificationRead,
      markAllNotificationsRead,
      messageThreads,
      sendMessage,
      markThreadRead,
      refreshThreads,
      unreadMessageCount,
      lastMinuteAlertsEnabled: currentArtist?.lastMinuteAlerts ?? false,
      setLastMinuteAlertsEnabled,
      isSupportPlus,
      supportPlusBillingPeriod,
      supportPlusStatus,
      supportPlusPeriodEnd,
      supportPlusCancelAtPeriodEnd,
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
      user,
      loadError,
      reload,
      suspended,
      adminRole,
      applications,
      bookings,
      apply,
      refreshApplications,
      savedSlotIds,
      toggleSavedSlot,
      emailNotifications,
      setEmailNotificationsPref,
      notifications,
      unreadNotificationCount,
      markNotificationRead,
      markAllNotificationsRead,
      messageThreads,
      sendMessage,
      markThreadRead,
      refreshThreads,
      unreadMessageCount,
      setLastMinuteAlertsEnabled,
      isSupportPlus,
      supportPlusBillingPeriod,
      supportPlusStatus,
      supportPlusPeriodEnd,
      supportPlusCancelAtPeriodEnd,
      startSupportPlusCheckout,
      openBillingPortal,
      setArtistAvatar,
      setPromoterAvatar,
      setArtistLinks,
      setArtistMonthlyListeners,
      addSlot,
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
