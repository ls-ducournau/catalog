import { ImageResponse } from "next/og";
import { PALETTE_PARTAGE as P, PARTAGE } from "@/lib/partage";

// L'aperçu d'un lien partagé (Reddit, Discord, WhatsApp, X) — docs/audit/landing-ux-marketing-2026-11-09.md.
// La promesse à gauche ; à droite, le geste : un paquet de cartes, celle du dessus penchée avec « Ça me
// tente ». Les éclats de la marque en fond, comme le héros. Généré une fois, à la construction.

export const alt = PARTAGE.alt;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

function Carte({ rotation, x, y, opacite, tampon }: { rotation: number; x: number; y: number; opacite: number; tampon?: boolean }) {
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: 250,
        height: 375,
        borderRadius: 24,
        background: `linear-gradient(160deg, ${P.carte2}, ${P.carte})`,
        border: `2px solid ${P.arete}`,
        transform: `rotate(${rotation}deg)`,
        opacity: opacite,
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        padding: 24,
      }}
    >
      {tampon && (
        <div
          style={{
            position: "absolute",
            top: 28,
            left: 22,
            padding: "6px 14px",
            border: `3px solid ${P.texte}`,
            borderRadius: 8,
            background: P.voile,
            color: P.texte,
            fontSize: 26,
            fontWeight: 700,
            letterSpacing: 2,
            transform: "rotate(-10deg)",
          }}
        >
          ÇA ME TENTE
        </div>
      )}
      <div style={{ display: "flex", width: 150, height: 16, borderRadius: 8, background: P.gris, opacity: 0.6 }} />
      <div style={{ display: "flex", width: 100, height: 12, borderRadius: 6, background: P.gris, opacity: 0.35, marginTop: 12 }} />
    </div>
  );
}

export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: P.degrade, position: "relative", overflow: "hidden" }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 72px", width: 680, height: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ width: 52, height: 52, borderRadius: 14, background: P.marque, display: "flex", alignItems: "center", justifyContent: "center", color: P.texte, fontSize: 32, fontWeight: 800 }}>
              C
            </div>
            <div style={{ color: P.texte, fontSize: 36, fontWeight: 700 }}>Catalog</div>
          </div>
          <div style={{ color: P.texte, fontSize: 64, fontWeight: 700, lineHeight: 1.08, marginTop: 40 }}>{PARTAGE.accroche}</div>
          <div style={{ color: P.gris, fontSize: 28, lineHeight: 1.35, marginTop: 28 }}>Films, séries et documentaires. Gratuit pendant la bêta, sans inscription.</div>
        </div>
        <Carte rotation={-8} x={760} y={150} opacite={0.55} />
        <Carte rotation={4} x={800} y={130} opacite={0.8} />
        <Carte rotation={12} x={850} y={110} opacite={1} tampon />
      </div>
    ),
    size
  );
}
