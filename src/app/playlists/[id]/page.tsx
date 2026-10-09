import { CatalogLayout } from "@/components/layouts";
import { PlaylistView } from "@/components/playlists/PlaylistView";

// Une playlist — spec: specs/playlists-v1.md (FR-11, FR-12). Archétype CatalogLayout.
export default async function PlaylistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <CatalogLayout>
      <PlaylistView id={Number(id)} />
    </CatalogLayout>
  );
}
