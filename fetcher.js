(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./parser.js'), require('./merge.js'), require('./industries.js'));
  else root.Fetcher = factory(root.TgParser, root.Merge, root.Industries);
})(typeof self !== 'undefined' ? self : this, function (P, M, I) {
  'use strict';
  const MAX_DATE_PAGES = 30;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---- لینک کانال ---- */
  const RE = /^(?:https?:\/\/)?(?:(?:www\.)?(?:t|telegram)\.me\/(?:s\/)?|@)?([A-Za-z][A-Za-z0-9_]{3,31})(?:\/\d+)?\/?(?:\?.*)?$/;
  function parseChannel(input) { const m = String(input || '').trim().match(RE); return m ? m[1] : null; }
  // چند کانال با ویرگول، فاصله یا خط جدید جدا می‌شوند (حداکثر ۵ کانال)
  function parseChannels(input) {
    const names = [], bad = [];
    for (const p of String(input || '').split(/[\s,،;]+/).filter(Boolean)) {
      const n = parseChannel(p);
      if (n) { if (!names.includes(n)) names.push(n); } else bad.push(p);
    }
    return { names: names.slice(0, 5), bad };
  }

  /* ---- تاریخ ---- */
  function parseDay(str, endOfDay) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(str || '')) return null;
    const t = Date.parse(str + (endOfDay ? 'T23:59:59Z' : 'T00:00:00Z'));
    return Number.isNaN(t) ? null : t;
  }
  function inRange(ts, from, to) { // پست بدون تاریخ همیشه داخل بازه است
    if (ts == null) return true;
    if (to != null && ts > to) return false;
    if (from != null && ts < from) return false;
    return true;
  }

  /* ---- خزش صفحه‌های t.me/s/<channel>؛ getPage(url) باید HTML برگرداند ---- */
  async function crawl(name, opts, getPage) {
    opts = opts || {};
    const from = parseDay(opts.from, false), to = parseDay(opts.to, true);
    const cap = Math.max(1, Math.min(200, Math.floor(opts.maxPages) || MAX_DATE_PAGES));
    const limit = from != null ? cap : Math.max(1, Math.min(15, Math.floor(opts.pages) || 3));
    const delay = opts.delay == null ? 400 : opts.delay;
    const reports = [], mentions = [];
    let before = null, scanned = 0, used = 0, reached = false, end = false, partial = null;
    for (let i = 0; i < limit; i++) {
      if (opts.onProgress) opts.onProgress({ channel: name, page: i + 1, limit });
      let html;
      try { html = await getPage(`https://t.me/s/${name}` + (before ? `?before=${before}` : '')); }
      catch (e) { if (i === 0) throw e; partial = e.message || 'خطا'; break; } // خطا وسط راه: داده‌ی گرفته‌شده حفظ می‌شود
      const { posts, minId } = P.parsePage(html);
      if (!posts.length && !minId) {
        if (i === 0) throw new Error('پستی پیدا نشد. کانال باید عمومی باشد و پیش‌نمایش وب (t.me/s/…) داشته باشد.');
        end = true; break;
      }
      used++;
      let oldest = Infinity;
      for (const p of posts) {
        const ts = p.date ? Date.parse(p.date) : null;
        if (ts != null) oldest = Math.min(oldest, ts);
        if (!inRange(ts, from, to)) continue;
        scanned++;
        for (const t of p.tags || []) mentions.push([t, p.date]);
        const r = P.extractRecord(p);
        if (r) reports.push(Object.assign({}, r, { channel: name }));
      }
      if (from != null && oldest < from) { reached = true; break; }
      if (!minId || minId === before) { end = true; break; }
      before = minId;
      if (i < limit - 1 && delay) await sleep(delay);
    }
    return {
      channel: name, scanned, pages: used, updatedAt: new Date().toISOString(),
      from: opts.from || null, to: opts.to || null,
      truncated: from != null && !reached && !end && !partial, partial, reports, mentions,
    };
  }

  /* ---- ادغام نتیجه‌ی چند کانال ---- */
  function flatten(results) {
    const ok = results.filter((r) => !r.error);
    return {
      reports: ok.flatMap((r) => r.reports),
      mentions: ok.flatMap((r) => r.mentions.map((m) => [r.channel, m[0], m[1]])),
    };
  }
  function assemble(results, o) {
    o = o || {};
    const f = flatten(results);
    return {
      generatedAt: new Date().toISOString(),
      range: { from: o.from || null, to: o.to || null },
      channels: results.filter((r) => !r.error).map((r) => r.channel),
      failed: results.filter((r) => r.error).map((r) => ({ channel: r.channel, error: r.error })),
      scanned: results.reduce((a, r) => a + (r.scanned || 0), 0),
      truncated: results.some((r) => r.truncated),
      partial: results.some((r) => r.partial),
      prices: { ok: 0, failed: 0, skipped: true }, priceMap: {},
      industries: I.NAMES,
      records: M.derive(f.reports, f.mentions, o.from, o.to),
      reports: f.reports, mentions: f.mentions,
    };
  }

  /* ---- دریافت از داخل مرورگر از طریق پراکسی (مرورگر مستقیم به t.me دسترسی CORS ندارد) ---- */
  const DEFAULT_PROXIES = [
    (u) => 'https://corsproxy.io/?url=' + encodeURIComponent(u),
    (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
    (u) => 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u),
  ];
  // custom: آدرس پراکسی شخصی؛ آدرس t.me/s/… به انتهایش (URL-encoded) چسبانده می‌شود.
  function proxyBuilders(custom) {
    const mine = String(custom || '').trim();
    return (mine ? [(u) => mine + encodeURIComponent(u)] : []).concat(DEFAULT_PROXIES);
  }
  // پراکسی‌ای که جواب داد برای صفحه‌های بعد اول امتحان می‌شود.
  function proxyGetter(builders, o) {
    o = o || {};
    const order = builders.slice(), timeout = o.timeout || 15000, fetchFn = o.fetch || (typeof fetch !== 'undefined' ? fetch : null);
    return async function (url) {
      const errors = [];
      for (let i = 0; i < order.length; i++) {
        try {
          const opt = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? { signal: AbortSignal.timeout(timeout) } : {};
          const res = await fetchFn(order[i](url), opt);
          if (!res.ok) { errors.push('HTTP ' + res.status); continue; }
          const t = await res.text();
          if (/tgme_widget_message|tgme_channel_info|tgme_page/.test(t)) { if (i) order.unshift(order.splice(i, 1)[0]); return t; }
          errors.push('پاسخ نامعتبر');
        } catch (e) { errors.push(e && e.message ? e.message : 'خطا'); }
      }
      throw new Error('هیچ پراکسی‌ای جواب نداد (' + errors.join('، ') + ')؛ VPN را روشن کن یا پراکسی شخصی بساز (راهنما در README).');
    };
  }
  async function fetchSnapshot(names, opts, getPage) {
    opts = opts || {};
    const results = [];
    for (const n of names) {
      try { results.push(await crawl(n, opts, getPage)); }
      catch (e) { results.push({ channel: n, error: e.message || 'خطا', reports: [], mentions: [] }); }
    }
    return assemble(results, opts);
  }

  return { parseChannel, parseChannels, parseDay, inRange, crawl, flatten, assemble, proxyBuilders, proxyGetter, fetchSnapshot, DEFAULT_PROXIES };
});
