import type { Metadata, Viewport } from "next";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/700.css";
import "./globals.css";
import AppGate from "@/components/layout/AppGate";
import { StoreProvider } from "@/lib/store";

export const metadata: Metadata = {
  title: "Support Slot — Find your next stage.",
  description:
    "A marketplace for musicians to find and apply for support slots at live shows. Discover opportunities, apply in seconds, play in front of audiences that fit your music.",
};

export const viewport: Viewport = {
  themeColor: "#0a0a0b",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <StoreProvider>
          <AppGate>{children}</AppGate>
        </StoreProvider>
      </body>
    </html>
  );
}
