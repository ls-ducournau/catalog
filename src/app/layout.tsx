import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import NavBar from "./NavBar";
import { MotionRoot } from "@/components/MotionRoot";
import { BackToTop } from "@/components/BackToTop";
import "./globals.css";

// Polices de DESIGN.md (Raycast) : Inter pour l'interface, Geist Mono pour les mentions techniques.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Catalog",
  description: "Tes films, séries et documentaires : duels, classement, recommandations, sorties et soirées.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="fr"
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <MotionRoot />
        <NavBar />
        {children}
        <BackToTop />
      </body>
    </html>
  );
}
