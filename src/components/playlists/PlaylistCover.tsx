import { ListVideo } from "lucide-react";
import { cn } from "@/lib/utils";

// Couverture d'une playlist (spec playlists-v1 FR-10, EC-2) : les affiches de ses quatre premiers
// titres en mosaïque, au format d'une affiche ; une seule affiche la remplit, sans titre une
// couverture neutre.

export function PlaylistCover({ covers, className }: { covers: string[]; className?: string }) {
  const shown = covers.slice(0, 4);
  return (
    <div aria-hidden="true" className={cn("playlist-cover", className)} data-count={shown.length}>
      {shown.length === 0 ? (
        <ListVideo size={28} className="text-subtle" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        shown.map((url, i) => <img key={`${i}-${url}`} src={url} alt="" loading="lazy" draggable={false} />)
      )}
    </div>
  );
}
