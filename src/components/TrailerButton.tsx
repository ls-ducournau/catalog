"use client";

import { buttonClass } from "@/components/ui/Button";
import { useEffect, useRef, useState, type PointerEvent, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, LoaderCircle, Play, RotateCcw, X } from "lucide-react";
import {
  trailerFailureCopy,
  trailerFailureFromCode,
  trailerPlayerVars,
  trailerSearchUrl,
  trailerWatchUrl,
  type Trailer,
  type TrailerFailure,
} from "@/lib/trailer";
import { useTrailerMode, writeTrailerMode } from "@/components/trailerMode";

// Bandes-annonces — spec: specs/bandes-annonces-v1.md (FR-3 à FR-7, NFR-1 à NFR-3)

function languageTag(trailer: Trailer): string {
  return trailer.language === "fr" ? "VF" : "VO";
}

/**
 * FR-3 : le bouton n'existe que s'il y a une bande-annonce, et qu'on ne les a pas masquées (FR-7).
 * Le clic ouvre le lecteur dans l'app, ou YouTube si c'est le réglage choisi ; il ne déclenche ni
 * l'ouverture d'une carte, ni le balayage du tri rapide.
 */
export function TrailerButton({
  trailer,
  title,
  variant = "pill",
  onImage = false,
  className = "",
}: {
  trailer: Trailer | null;
  title: string;
  /** pill : « ▶ Bande-annonce VF » ; icon : rond, pour les grappes d'actions sur une affiche. */
  variant?: "pill" | "icon";
  /** Posé sur une image : la pastille prend l'aspect `overlay` (noir translucide, flou), lisible sur une affiche claire. */
  onImage?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const mode = useTrailerMode();
  if (!trailer || mode === "hidden") return null;

  const stop = (e: PointerEvent | MouseEvent) => e.stopPropagation();
  const style =
    variant === "icon"
      ? buttonClass({ variant: "overlay", icon: true, className })
      : buttonClass({ variant: onImage ? "overlay" : "secondary", className });
  const content = (
    <>
      <Play size={variant === "icon" ? 16 : 14} aria-hidden="true" className={variant === "icon" ? "" : "fill-current"} />
      {variant === "pill" && (
        <>
          Bande-annonce
          <span className="badge h-5 px-1">{languageTag(trailer)}</span>
          {(mode === "youtube" || trailer.embeddable === false) && <ExternalLink size={12} aria-hidden="true" className="text-muted" />}
        </>
      )}
    </>
  );

  // FR-7 : « toujours ouvrir sur YouTube » ; FR-8 : vidéo que sa chaîne réserve à YouTube. Dans
  // les deux cas, le bouton devient un lien : pas de lecteur voué à l'échec.
  if (mode === "youtube" || trailer.embeddable === false) {
    return (
      <a
        href={trailerWatchUrl(trailer)}
        target="_blank"
        rel="noopener noreferrer"
        onPointerDown={stop}
        onClick={stop}
        aria-label={`Bande-annonce de « ${title} » sur YouTube (${languageTag(trailer)})`}
        title={
          trailer.embeddable === false
            ? `Sur YouTube : ${trailer.channel ?? "sa chaîne"} la réserve à YouTube (${languageTag(trailer)})`
            : `Bande-annonce sur YouTube (${languageTag(trailer)})`
        }
        className={style}
      >
        {content}
      </a>
    );
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onPointerDown={stop}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        aria-label={`Bande-annonce de « ${title} » (${languageTag(trailer)})`}
        title={`Bande-annonce (${languageTag(trailer)})`}
        className={style}
      >
        {content}
      </button>
      {open &&
        createPortal(
          <TrailerPlayer
            trailer={trailer}
            title={title}
            onClose={() => {
              setOpen(false);
              // FR-4 : le focus revient au bouton d'origine.
              trigger.current?.focus();
            }}
          />,
          document.body
        )}
    </>
  );
}

// ---------- API du lecteur YouTube (FR-6) ----------

type YouTubePlayer = { destroy: () => void };
type YouTubeApi = {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string;
      width: string;
      height: string;
      playerVars: Record<string, string>;
      events: {
        onStateChange: (event: { data: number }) => void;
        onError: (event: { data: number }) => void;
      };
    }
  ) => YouTubePlayer;
};

declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiLoading: Promise<YouTubeApi> | null = null;

/** Chargée une fois, à la première bande-annonce ouverte (NFR-1 : rien avant le clic). */
function loadYouTubeApi(): Promise<YouTubeApi> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!apiLoading) {
    apiLoading = new Promise((resolve, reject) => {
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        previous?.();
        if (window.YT) resolve(window.YT);
      };
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.onerror = () => {
        // Bloquée (réseau, VPN, bloqueur) : on pourra retenter à la prochaine ouverture.
        script.remove();
        apiLoading = null;
        reject(new Error("youtube_api_unavailable"));
      };
      document.head.appendChild(script);
    });
  }
  return apiLoading;
}

/** FR-6 : sans lecture passé ce délai, on propose une autre voie. */
const START_TIMEOUT_MS = 6000;
const PLAYING = 1;
const BUFFERING = 3;

type PlayerStatus =
  | "loading"
  | "playing"
  /** Rien n'a démarré : lecture automatique bloquée, ou YouTube qui demande une connexion. */
  | "stalled"
  /** La vidéo ne se lira pas ici, pour la raison dite (FR-6). */
  | TrailerFailure;

/** FR-4 : lecteur en surimpression, au-dessus de tout (fiches comprises). */
function TrailerPlayer({ trailer, title, onClose }: { trailer: Trailer; title: string; onClose: () => void }) {
  const closeButton = useRef<HTMLButtonElement | null>(null);
  const host = useRef<HTMLDivElement | null>(null);
  const help = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<PlayerStatus>("loading");
  const [attempt, setAttempt] = useState(0);
  const { key, language } = trailer;

  useEffect(() => {
    closeButton.current?.focus();
    // FR-5 : tant que le lecteur est ouvert, les raccourcis des pages n'agissent pas. L'écoute en
    // phase de capture passe avant celles des pages, et arrête l'événement.
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
      if (e.key !== "Tab") e.stopImmediatePropagation();
    }
    window.addEventListener("keydown", onKey, true);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  // Le lecteur YouTube remplace l'élément qu'on lui confie : on lui en donne un créé à la main,
  // dans un conteneur dont React ne gère pas le contenu.
  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let player: YouTubePlayer | null = null;
    let cancelled = false;
    const timer = setTimeout(() => setStatus((s) => (s === "loading" ? "stalled" : s)), START_TIMEOUT_MS);

    loadYouTubeApi()
      .then((YT) => {
        if (cancelled) return;
        const target = document.createElement("div");
        container.appendChild(target);
        player = new YT.Player(target, {
          videoId: key,
          width: "100%",
          height: "100%",
          playerVars: trailerPlayerVars({ key, language, name: "", kind: "Trailer" }, window.location.origin),
          events: {
            onStateChange: (event) => {
              if (event.data === PLAYING || event.data === BUFFERING) setStatus("playing");
            },
            onError: (event) => setStatus(trailerFailureFromCode(event.data)),
          },
        });
      })
      .catch(() => {
        if (!cancelled) setStatus("player_unavailable");
      });

    return () => {
      cancelled = true;
      clearTimeout(timer);
      player?.destroy();
      container.replaceChildren();
    };
  }, [key, language, attempt]);

  // Sur un écran peu haut, l'aide naît sous le bord : on l'amène dans le champ.
  useEffect(() => {
    if (status !== "stalled") return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    help.current?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, [status]);

  const watchUrl = trailerWatchUrl(trailer);
  const retry = () => {
    setStatus("loading");
    setAttempt((n) => n + 1);
  };
  const alwaysOnYouTube = () => {
    writeTrailerMode("youtube");
    window.open(watchUrl, "_blank", "noopener,noreferrer");
    onClose();
  };
  const failure =
    status === "loading" || status === "playing" || status === "stalled" ? null : trailerFailureCopy(status, trailer.channel);
  const failed = failure !== null;

  return (
    <div
      className="fade-in fixed inset-0 z-[80] flex items-center justify-center bg-black/85 p-3 backdrop-blur-sm sm:p-8"
      onClick={onClose}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Bande-annonce de « ${title} »`}
        onClick={(e) => e.stopPropagation()}
        className="dialog-in flex max-h-full w-full max-w-5xl flex-col gap-3 overflow-y-auto"
      >
        <div className="flex items-center gap-3">
          <p className="min-w-0 flex-1 truncate text-base font-semibold text-white">
            {title}
            <span className="ml-2 rounded bg-white/15 px-1.5 py-0.5 align-middle text-xs font-semibold text-white/80">
              {trailer.kind === "Teaser" ? "Teaser" : "Bande-annonce"} {languageTag(trailer)}
            </span>
          </p>
          {!failed && (
            <a
              href={watchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClass({ variant: "ghost", size: "lg" })}
            >
              <ExternalLink size={14} aria-hidden="true" />
              <span className="hidden sm:inline">Ouvrir sur YouTube</span>
              <span className="sm:hidden">YouTube</span>
            </a>
          )}
          <button
            ref={closeButton}
            type="button"
            onClick={onClose}
            aria-label="Fermer la bande-annonce"
            className={buttonClass({ variant: "secondary", size: "lg", icon: true })}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <div
          className={`relative w-full shrink-0 overflow-hidden rounded-xl bg-black shadow-2xl shadow-black/60 ${
            failed ? "sm:aspect-video" : "aspect-video"
          }`}
        >
          {status === "loading" && (
            <div className="absolute inset-0 flex items-center justify-center text-white/40">
              <LoaderCircle size={28} aria-hidden="true" className="motion-safe:animate-spin" />
            </div>
          )}
          {/* Positionné après l'indicateur : l'iframe du lecteur le recouvre dès qu'elle s'affiche. */}
          <div ref={host} className={`relative h-full w-full ${failed ? "hidden" : ""}`} />
          {/* FR-6 : la vidéo ne se lira pas ici : le recours prend sa place, avec la vraie cause. */}
          {failure && (
            <div className="flex flex-col items-center justify-center gap-4 px-5 py-8 text-center sm:absolute sm:inset-0 sm:p-6">
              <div className="max-w-md">
                <p className="text-balance text-base font-semibold text-white">{failure.title}</p>
                <p className="mt-1 text-balance text-sm text-white/70">{failure.detail}</p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                <a
                  href={failure.action === "search" ? trailerSearchUrl(title) : watchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonClass({ variant: "primary", size: "lg" })}
                >
                  <ExternalLink size={16} aria-hidden="true" />
                  {failure.action === "search" ? "Chercher sur YouTube" : "Regarder sur YouTube"}
                </a>
                {failure.retry && (
                  <button
                    type="button"
                    onClick={retry}
                    className={buttonClass({ variant: "secondary", size: "lg" })}
                  >
                    <RotateCcw size={15} aria-hidden="true" />
                    Réessayer
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* FR-6 : rien n'a démarré. Le lecteur reste visible (la lecture peut encore partir d'un
            clic sur ▶), mais on donne la cause probable et les issues. */}
        {status === "stalled" && (
          <div ref={help} role="status" className="fade-in rounded-xl bg-white/10 p-4 text-sm text-white">
            <p className="font-semibold">La vidéo ne démarre pas ?</p>
            <p className="mt-1 max-w-[70ch] text-white/75">
              Lance-la avec ▶ dans le lecteur. Si YouTube demande plutôt de prouver que tu n&apos;es pas un
              robot, c&apos;est souvent à cause d&apos;un <strong className="font-semibold text-white">VPN</strong> :
              coupe-le, puis réessaie. Se connecter ici ne marchera pas, Google interdit sa page de connexion à
              l&apos;intérieur d&apos;un autre site.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href={watchUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClass({ variant: "primary", size: "lg" })}
              >
                <ExternalLink size={16} aria-hidden="true" />
                Regarder sur YouTube
              </a>
              <button
                type="button"
                onClick={retry}
                className={buttonClass({ variant: "secondary", size: "lg" })}
              >
                <RotateCcw size={15} aria-hidden="true" />
                Réessayer
              </button>
              <button
                type="button"
                onClick={alwaysOnYouTube}
                className={buttonClass({ variant: "ghost", size: "lg" })}
              >
                Toujours ouvrir sur YouTube
              </button>
            </div>
            <p className="mt-2 text-xs text-white/55">Ce choix se change à tout moment dans les réglages (⚙), en haut de page.</p>
          </div>
        )}

        {trailer.language !== "fr" && !failed && (
          <p className="text-center text-xs text-white/60">Pas de version française : sous-titres demandés à YouTube.</p>
        )}
      </div>
    </div>
  );
}
