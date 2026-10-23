// پراکسی شخصی و رایگان روی Cloudflare Workers برای دکمه‌ی «دریافت اکنون».
// فقط صفحه‌های عمومی t.me/s/<کانال> را عبور می‌دهد.
export default {
  async fetch(request) {
    const cors = { 'Access-Control-Allow-Origin': '*' };
    if (request.method === 'OPTIONS') return new Response(null, { headers: { ...cors, 'Access-Control-Allow-Methods': 'GET' } });
    const target = new URL(request.url).searchParams.get('url');
    let u;
    try { u = new URL(target); } catch { return new Response('bad url', { status: 400, headers: cors }); }
    if (u.protocol !== 'https:' || u.hostname !== 't.me' || !u.pathname.startsWith('/s/')) return new Response('forbidden', { status: 403, headers: cors });
    const r = await fetch(u.toString(), { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'fa,en' } });
    return new Response(await r.text(), { status: r.status, headers: { ...cors, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=120' } });
  },
};
