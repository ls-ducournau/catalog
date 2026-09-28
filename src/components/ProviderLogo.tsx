import { providerLogoUrl, type Provider } from "@/lib/availability";

/** Logo d'un service de streaming ; ses initiales quand TMDB n'en a pas. */
export function ProviderLogo({ provider, size = 20 }: { provider: Provider; size?: number }) {
  const url = providerLogoUrl(provider.logoPath);
  const style = { width: size, height: size };

  if (!url) {
    return (
      <span
        title={provider.name}
        style={style}
        className="inline-flex shrink-0 items-center justify-center rounded-md bg-white/10 text-xs font-semibold text-foreground"
      >
        {provider.name.slice(0, 2).toUpperCase()}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={provider.name}
      title={provider.name}
      style={style}
      className="shrink-0 rounded-md object-cover"
    />
  );
}
