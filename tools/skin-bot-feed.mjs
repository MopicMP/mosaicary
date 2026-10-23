// The skin bot's feed: players named by open lists, handed to the site to ask Mojang about.
//
// Mojang keeps no list of its players, so the skin bot (tools/skin-bot.mjs) learns of one
// only when somebody looks a name up on the site. This adds players from public lists
// that already name them by UUID: today the leaderboards Wynncraft publishes through its
// API, which needs no key. The site keeps them waiting (POST /api/bot/candidates) and
// every run of the bot asks Mojang about a few hundred; whoever has a profile becomes a
// player from Mojang's own signed answer, never from the list.
//
// Players who hide their profile on Wynncraft come back without a UUID ("redacted") and
// are left out. Run once a day by .github/workflows/skin-bot.yml; asking again is cheap,
// since the site leaves out everybody it has already.
//
// Usage:
//   node tools/skin-bot-feed.mjs           fetch the lists and hand them to the site
//   node tools/skin-bot-feed.mjs --dry     fetch the lists and print how many, nothing sent
//
// Read from the environment: SKIN_BOT_KEY (required unless --dry) and SITE_ORIGIN.

const SITE = (process.env.SITE_ORIGIN || 'https://mosaicary.com').replace(/\/+$/, '');
const KEY = (process.env.SKIN_BOT_KEY || '').trim();
const dry = process.argv.includes('--dry');
const AGENT = 'mosaicary-skin-bot (+https://mosaicary.com)';

/** Wynncraft lets a caller without a key make 50 requests a minute; this makes under 40. */
const WYNNCRAFT_GAP = 1600;
/** The longest list Wynncraft hands out in one answer. */
const WYNNCRAFT_ROWS = 1000;
/** How many UUIDs one POST to the site carries: the most it takes (BOT_CANDIDATES_MOST). */
const POST_SIZE = 1000;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function getJson(url) {
  const response = await fetch(url, { headers: { 'user-agent': AGENT } });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.json();
}

/**
 * Every player on Wynncraft's player leaderboards, by UUID without dashes.
 *
 * The guild boards are left out: they name guilds, not players. A board that fails is
 * skipped and said so; the others still count.
 */
async function wynncraft() {
  const uuids = new Set();
  const types = await getJson('https://api.wynncraft.com/v3/leaderboards/types');
  for (const type of types.filter((one) => typeof one === 'string' && !one.startsWith('guild'))) {
    await sleep(WYNNCRAFT_GAP);
    try {
      const board = await getJson(`https://api.wynncraft.com/v3/leaderboards/${encodeURIComponent(type)}?resultLimit=${WYNNCRAFT_ROWS}`);
      for (const row of Object.values(board)) {
        const uuid = String(row?.uuid ?? '').replace(/-/g, '').toLowerCase();
        if (/^[0-9a-f]{32}$/.test(uuid)) uuids.add(uuid);
      }
    } catch (why) {
      console.warn(`wynncraft ${type}: ${why.message}`);
    }
  }
  return [...uuids];
}

async function main() {
  if (!dry && !KEY) {
    console.error('SKIN_BOT_KEY is not set');
    return 1;
  }
  const uuids = await wynncraft();
  console.log(`wynncraft: ${uuids.length} players on its leaderboards`);
  if (dry) return 0;
  let added = 0;
  let waiting = 0;
  for (let from = 0; from < uuids.length; from += POST_SIZE) {
    const response = await fetch(`${SITE}/api/bot/candidates`, {
      method: 'POST',
      headers: { 'x-bot-key': KEY, 'user-agent': AGENT, 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'wynncraft', uuids: uuids.slice(from, from + POST_SIZE) }),
    });
    if (!response.ok) {
      console.error(`POST /api/bot/candidates: ${response.status} ${await response.text()}`);
      return 1;
    }
    const said = await response.json();
    added += said.added;
    waiting = said.waiting;
  }
  console.log(`site: ${added} new, ${waiting} waiting for the bot`);
  return 0;
}

// Through `process.exitCode`, as in skin-bot.mjs: Node on Windows aborts when made to exit
// while fetch's connection is closing.
process.exitCode = await main();
