import { CatalogLayout } from "@/components/layouts";
import { PlaylistsIndex } from "@/components/playlists/PlaylistsIndex";

// Playlists — spec: specs/playlists-v1.md (FR-10). Archétype CatalogLayout (le Store).
export default function PlaylistsPage() {
  return (
    <CatalogLayout>
      <PlaylistsIndex />
    </CatalogLayout>
  );
}
