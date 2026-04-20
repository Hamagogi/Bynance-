import { YoutubeTranscript } from 'youtube-transcript';

export function extractYoutubeId(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1) || null;
    if (u.hostname.includes('youtube.com')) {
      if (u.searchParams.get('v')) return u.searchParams.get('v');
      const parts = u.pathname.split('/').filter(Boolean);
      const idx = parts.findIndex((p) => ['shorts', 'embed', 'v'].includes(p));
      if (idx !== -1 && parts[idx + 1]) return parts[idx + 1];
    }
  } catch {
    return null;
  }
  return null;
}

async function fetchYoutubeTitle(videoId) {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=${videoId}`,
      { cache: 'no-store' }
    );
    if (!res.ok) return null;
    const json = await res.json();
    return json.title || null;
  } catch {
    return null;
  }
}

export async function getYoutubeTranscript(url) {
  const id = extractYoutubeId(url);
  if (!id) throw new Error('Invalid YouTube URL.');

  let items;
  try {
    items = await YoutubeTranscript.fetchTranscript(id);
  } catch (err) {
    throw new Error(
      'Could not fetch transcript. The video may have captions disabled.'
    );
  }
  const text = items.map((i) => i.text).join(' ').replace(/\s+/g, ' ').trim();
  if (!text) throw new Error('Transcript was empty.');

  const title = await fetchYoutubeTitle(id);
  return { title: title || `YouTube video ${id}`, content: text, videoId: id };
}
