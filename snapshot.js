'use strict';
const F = require('../fetcher.js');
const { fetchChannels } = require('./channel');
const { applyPrices } = require('./prices');

async function buildFromChannels(names, { from = '', to = '', pages = 3, maxPages, prices = true } = {}) {
  const results = await fetchChannels(names, { from, to, pages, maxPages });
  const snap = F.assemble(results, { from, to });
  if (prices) {
    snap.prices = await applyPrices(snap.records);
    for (const r of snap.records) if (r.priceNow) snap.priceMap[r.symbol] = r.priceNow;
  }
  return snap;
}

module.exports = { collect: F.flatten, buildFromChannels };
