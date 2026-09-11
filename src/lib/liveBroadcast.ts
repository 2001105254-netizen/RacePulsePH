// User-supplied broadcasts and map links must never be rendered unless they
// are ordinary http(s) URLs. This keeps the public hub from accepting
// javascript: or data: URLs while remaining provider-agnostic.
export function safeExternalUrl(value?: string): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function youtubeEmbedUrl(value?: string): string | undefined {
  const urlValue = safeExternalUrl(value);
  if (!urlValue) return undefined;
  const url = new URL(urlValue);
  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  let videoId = '';

  if (host === 'youtu.be') videoId = url.pathname.split('/').filter(Boolean)[0] || '';
  if (host === 'youtube.com' || host === 'm.youtube.com') {
    if (url.pathname === '/watch') videoId = url.searchParams.get('v') || '';
    else if (url.pathname.startsWith('/live/') || url.pathname.startsWith('/embed/')) videoId = url.pathname.split('/')[2] || '';
  }

  return /^[a-zA-Z0-9_-]{6,}$/.test(videoId)
    ? `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=0&rel=0`
    : undefined;
}

export function embeddableMapUrl(value?: string): string | undefined {
  const urlValue = safeExternalUrl(value);
  if (!urlValue) return undefined;
  const url = new URL(urlValue);
  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  const isGoogleEmbed = (host === 'google.com' || host.endsWith('.google.com')) && url.pathname.startsWith('/maps/embed');
  const isOpenStreetMapEmbed = host.endsWith('openstreetmap.org') && url.pathname.startsWith('/export/embed.html');
  return isGoogleEmbed || isOpenStreetMapEmbed ? urlValue : undefined;
}
