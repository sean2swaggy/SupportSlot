import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Loading } from "./components/ui";
import { NoticeProvider, SessionProvider } from "./hooks";
import { Landing } from "./pages/Landing";
import { Browse } from "./pages/Browse";
import { SlotDetail } from "./pages/SlotDetail";
import { Bookings } from "./pages/Bookings";
import { BookingDetail } from "./pages/BookingDetail";
import { Listings } from "./pages/Listings";
import { ListingForm } from "./pages/ListingForm";
import { ListingManage } from "./pages/ListingManage";
import { SignIn, SignUp } from "./pages/Auth";
import { Profile } from "./pages/Profile";
import { Notifications } from "./pages/Notifications";
import { Messages, Thread } from "./pages/Messages";
import { NotFound } from "./pages/NotFound";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <SessionProvider fallback={<div className="page"><Loading label="Starting Support Slot" /></div>}>
        <NoticeProvider>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Landing />} />
              <Route path="slots" element={<Browse />} />
              <Route path="slots/:id" element={<SlotDetail />} />
              <Route path="bookings" element={<Bookings />} />
              <Route path="bookings/:id" element={<BookingDetail />} />
              <Route path="listings" element={<Listings />} />
              <Route path="listings/new" element={<ListingForm />} />
              <Route path="listings/:id" element={<ListingManage />} />
              <Route path="signin" element={<SignIn />} />
              <Route path="signup" element={<SignUp />} />
              <Route path="profile" element={<Profile />} />
              <Route path="notifications" element={<Notifications />} />
              <Route path="messages" element={<Messages />} />
              <Route path="messages/:listingId/:artistId" element={<Thread />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </NoticeProvider>
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>,
);
