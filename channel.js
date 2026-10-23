'use strict';
const F = require('../fetcher.js');

const cache = new Map(); // key -> {at, data}
const TTL = 5 * 60 * 1000;

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; bourse-watchlist/1.0)', 'Accept-Language': 'fa,en' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`تلگرام پاسخ ${res.status} داد`);
  return res.text();
}

async function fetchChannel(name, opts = {}) {
  const key = [name, opts.from || '', opts.to || '', opts.pages || '', opts.maxPages || ''].join('|');
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return { ...hit.data, cached: true };
  const data = await F.crawl(name, opts, fetchPage);
  cache.set(key, { at: Date.now(), data });
  return data;
}

// چند کانال را پشت‌سرهم می‌خواند؛ خطای یک کانال بقیه را خراب نمی‌کند.
async function fetchChannels(names, opts = {}) {
  const out = [];
  for (const n of names) {
    try { out.push(await fetchChannel(n, opts)); }
    catch (e) { out.push({ channel: n, error: e.message || 'خطا', reports: [], mentions: [] }); }
  }
  return out;
}

module.exports = { parseChannel: F.parseChannel, parseChannels: F.parseChannels, parseDay: F.parseDay, inRange: F.inRange, fetchChannel, fetchChannels };
