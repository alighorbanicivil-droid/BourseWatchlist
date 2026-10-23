'use strict';
const test = require('node:test');
const assert = require('node:assert');
const F = require('../fetcher.js');

const post = (id, iso, sym, eps, price) => `<div class="tgme_widget_message_wrap"><div data-post="Ch/${id}"></div><div class="tgme_widget_message_text js-message_text">#${sym}<br/>صورت مالی شش ماهه<br/>سود شش ماهه ${eps} ریال<br/>قیمت روز ${price} ریال<br/>ارزش بازار 10 همت</div><time datetime="${iso}"></time></div>`;
const PAGES = {
  '': post(30, '2026-10-20T10:00:00+00:00', 'فولاد', 300, 4000) + post(29, '2026-10-10T10:00:00+00:00', 'شراز', 2000, 9000),
  '29': post(28, '2026-09-20T10:00:00+00:00', 'فملی', 1000, 9000) + post(27, '2026-08-01T10:00:00+00:00', 'قدیمی', 1, 1),
};
const getPage = async (url) => PAGES[(url.split('before=')[1]) || ''] || '';

test('crawl: تا رسیدن به تاریخ شروع صفحه می‌گیرد و پست‌های بیرون از بازه را کنار می‌گذارد', async () => {
  const pages = [];
  const r = await F.crawl('Ch', { from: '2026-09-01', delay: 0, onProgress: (p) => pages.push(p.page) }, getPage);
  assert.deepStrictEqual(r.reports.map((x) => x.symbol), ['فولاد', 'شراز', 'فملی']);
  assert.deepStrictEqual([r.pages, r.truncated, pages.join()], [2, false, '1,2']);
});
test('crawl: بدون تاریخ فقط pages صفحه می‌خواند', async () => {
  const r = await F.crawl('Ch', { pages: 1, delay: 0 }, getPage);
  assert.deepStrictEqual([r.pages, r.reports.length], [1, 2]);
});
test('crawl: سقف maxPages ⇒ truncated', async () => {
  const r = await F.crawl('Ch', { from: '2026-01-01', maxPages: 1, delay: 0 }, getPage);
  assert.strictEqual(r.truncated, true);
});
test('crawl: کانال بدون پست خطا می‌دهد', async () => {
  await assert.rejects(F.crawl('Empty', { delay: 0 }, async () => '<html></html>'), /پستی پیدا نشد/);
});
test('fetchSnapshot: چند کانال، خطای یکی بقیه را خراب نمی‌کند و تأیید شمرده می‌شود', async () => {
  const get = async (url) => { if (url.includes('/s/Bad')) throw new Error('boom'); return getPage(url); };
  const s = await F.fetchSnapshot(['A', 'Bad', 'B'], { from: '2026-09-01', delay: 0 }, get);
  assert.deepStrictEqual([s.channels.join(), s.failed.length, s.records.length], ['A,B', 1, 3]);
  assert.strictEqual(s.records.find((r) => r.symbol === 'فولاد').confirms, 2);
  assert.ok(s.industries.P && s.reports.length === 6);
});

test('proxyGetter: پراکسی خراب را رد می‌کند و پراکسی سالم را برای بعد جلو می‌اندازد', async () => {
  const calls = [];
  const fake = async (u) => {
    calls.push(u.split('/')[2]);
    if (u.includes('bad1')) throw new Error('blocked');
    if (u.includes('bad2')) return { ok: true, text: async () => '<html>captcha</html>' };
    return { ok: true, text: async () => PAGES[''] };
  };
  const b = [(u) => 'https://bad1.test/?url=' + encodeURIComponent(u), (u) => 'https://bad2.test/?url=' + encodeURIComponent(u), (u) => 'https://good.test/?url=' + encodeURIComponent(u)];
  const get = F.proxyGetter(b, { fetch: fake });
  assert.ok((await get('https://t.me/s/Ch')).includes('tgme_widget_message'));
  await get('https://t.me/s/Ch?before=29');
  assert.deepStrictEqual(calls, ['bad1.test', 'bad2.test', 'good.test', 'good.test']);
});
test('proxyGetter: اگر همه خراب باشند خطای فارسی می‌دهد', async () => {
  const get = F.proxyGetter([(u) => 'https://x.test/?' + u], { fetch: async () => ({ ok: false, status: 403 }) });
  await assert.rejects(get('https://t.me/s/Ch'), /هیچ پراکسی/);
});
test('proxyBuilders: پراکسی شخصی اول می‌آید', () => {
  const b = F.proxyBuilders('https://w.dev/?url=');
  assert.strictEqual(b.length, F.DEFAULT_PROXIES.length + 1);
  assert.strictEqual(b[0]('https://t.me/s/Ch'), 'https://w.dev/?url=' + encodeURIComponent('https://t.me/s/Ch'));
});

test('crawl: خطا وسط راه ⇒ داده‌ی قبلی حفظ و partial علامت می‌خورد', async () => {
  let n = 0;
  const flaky = async (url) => { if (n++ === 1) throw new Error('proxy down'); return getPage(url); };
  const r = await F.crawl('Ch', { from: '2026-01-01', delay: 0 }, flaky);
  assert.deepStrictEqual([r.reports.length, r.partial, r.truncated], [2, 'proxy down', false]);
  const s = F.assemble([r], { from: '2026-01-01' });
  assert.strictEqual(s.partial, true);
});
