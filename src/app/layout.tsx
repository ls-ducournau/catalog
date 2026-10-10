import type { Metadata } from "next";
import { Bricolage_Grotesque, Geist_Mono, Work_Sans } from "next/font/google";
import NavBar from "./NavBar";
import { PlaylistDialogHost } from "@/components/playlists/PlaylistDialog";
import { ImpressionTracker } from "@/components/ImpressionTracker";
import { MotionRoot } from "@/components/MotionRoot";
import { BackToTop } from "@/components/BackToTop";
import "./globals.css";

// Polices (choix de l'utilisateur, 2026-09-28) : Work Sans pour le texte, Bricolage Grotesque en
// 600 pour les titres ; Geist Mono pour les mentions techniques (DESIGN.md, Raycast). Bricolage est
// une police variable avec l'axe de taille optique : un grand titre prend le dessin d'affichage.
const workSans = Work_Sans({
  variable: "--font-work-sans",
  subsets: ["latin"],
});

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  axes: ["opsz"],
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
      className={`${workSans.variable} ${bricolage.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <MotionRoot />
        <NavBar />
        {children}
        {/* playlists-v2 FR-1 : la fenêtre « Ajouter à une playlist », ouverte depuis n'importe quelle carte. */}
        <PlaylistDialogHost />
        {/* Fraîcheur des recommandations : relève les cartes de proposition vues à l'écran. */}
        <ImpressionTracker />
        <BackToTop />
      </body>
    </html>
  );
}
