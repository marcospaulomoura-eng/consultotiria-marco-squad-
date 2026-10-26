import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { MARCOS_CHANNEL_URL, canonicalYoutubeUrl, youtubeThumbnail, youtubeVideoId } from '../shared/youtube.mjs';

// Synthetic public video identifier, used only to exercise URL parsing offline.
const videoId = 'QAtest_01-a';
const canonical = `https://www.youtube.com/watch?v=${videoId}`;

test('YouTube URL helpers normalize watch, Shorts, embed and shared links without fetching metadata', () => {
  const values = [
    canonical,
    `https://youtube.com/watch?feature=share&v=${videoId}&t=4`,
    `https://m.youtube.com/shorts/${videoId}?feature=share`,
    `https://www.youtube.com/shorts/${videoId}/`,
    `https://www.youtube.com/embed/${videoId}#t=5`,
    `https://www.youtube-nocookie.com/embed/${videoId}`,
    `https://youtu.be/${videoId}?si=share`,
    `  HTTPS://WWW.YOUTUBE.COM:443/watch?v=${videoId}  `,
  ];
  for (const value of values) {
    assert.equal(youtubeVideoId(value), videoId, value);
    assert.equal(canonicalYoutubeUrl(value), canonical, value);
    assert.equal(youtubeThumbnail(value), `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, value);
  }
});

test('YouTube URL helpers reject channels, other hosts, unsafe schemes, paths and ambiguous IDs', () => {
  const invalid = [
    MARCOS_CHANNEL_URL,
    videoId,
    `/shorts/${videoId}`,
    `//youtube.com/watch?v=${videoId}`,
    `http://youtube.com/watch?v=${videoId}`,
    `https://youtube.com.example.invalid/watch?v=${videoId}`,
    `https://other.example.invalid/shorts/${videoId}`,
    `https://youtube.com.:443/watch?v=${videoId}`,
    `https://youtube.com:8443/watch?v=${videoId}`,
    'javascript:alert(1)',
    'data:text/plain,not-a-video',
    'https://youtube.com/results?search_query=treino',
    'https://youtube.com/@a-channel',
    'https://youtube.com/watch',
    `https://youtube.com/watch?id=${videoId}`,
    `https://youtube.com/watch?v=${videoId}&v=${videoId}`,
    `https://youtube.com/shorts/${videoId}/extra`,
    `https://youtube.com/embed/${videoId}/extra`,
    `https://youtu.be/${videoId}/extra`,
    'https://youtu.be/too-short',
    `https://youtu.be/${videoId}x`,
    'https://youtube.com/shorts/%51Atest_01-a',
    `https://www.you\ntube.com/watch?v=${videoId}`,
    `https:\\youtube.com\\watch?v=${videoId}`,
    'https://youtube.com/watch?v=' + 'x'.repeat(2100),
  ];
  for (const value of invalid) {
    assert.equal(youtubeVideoId(value), null, value);
    assert.equal(canonicalYoutubeUrl(value), null, value);
    assert.equal(youtubeThumbnail(value), null, value);
  }
});

test('YouTube URL helpers reject embedded user information without exposing its values', () => {
  const value = new URL(canonical);
  value.username = randomBytes(8).toString('hex');
  value.password = randomBytes(24).toString('hex');
  assert.equal(youtubeVideoId(value.href), null);
  assert.equal(canonicalYoutubeUrl(value.href), null);
  assert.equal(youtubeThumbnail(value.href), null);
});

test('YouTube URL helpers return null for missing or non-string input', () => {
  for (const value of [null, undefined, 0, false, {}, [], '', 'not a URL']) {
    assert.equal(youtubeVideoId(value), null);
    assert.equal(canonicalYoutubeUrl(value), null);
    assert.equal(youtubeThumbnail(value), null);
  }
});
