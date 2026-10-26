export const MARCOS_CHANNEL_URL = 'https://www.youtube.com/@marcosmoura.treinandor7/shorts';

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const LONG_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'www.youtube-nocookie.com']);

/** Read a video ID from a supported public HTTPS YouTube URL, never from a channel or raw ID. */
export function youtubeVideoId(value) {
  if (typeof value !== 'string') return null;
  const supplied = value.trim();
  if (supplied.length > 2048 || !/^https:\/\//i.test(supplied) || /[\u0000-\u001f\u007f\\]/.test(supplied)) return null;
  let url;
  try { url = new URL(supplied); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;

  let id = null;
  if (url.hostname === 'youtu.be') {
    id = url.pathname.match(/^\/([A-Za-z0-9_-]{11})\/?$/)?.[1] ?? null;
  } else if (LONG_HOSTS.has(url.hostname)) {
    if (url.pathname === '/watch') {
      const values = url.searchParams.getAll('v');
      if (values.length === 1) id = values[0];
    } else {
      id = url.pathname.match(/^\/(?:shorts|embed)\/([A-Za-z0-9_-]{11})\/?$/)?.[1] ?? null;
    }
  }
  return typeof id === 'string' && VIDEO_ID.test(id) ? id : null;
}

/** Stable form used for storage and duplicate detection; does not verify video availability. */
export function canonicalYoutubeUrl(value) {
  const id = youtubeVideoId(value);
  return id ? `https://www.youtube.com/watch?v=${id}` : null;
}

/** Official thumbnail URL for a supported video URL; no remote request is made here. */
export function youtubeThumbnail(value) {
  const id = youtubeVideoId(value);
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
}
