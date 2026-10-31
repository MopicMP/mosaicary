// The skin bot's feed: players named by open lists, handed to the site to ask Mojang about.
//
// Mojang keeps no list of its players, so the skin bot (tools/skin-bot.mjs) learns of one
// only when somebody looks a name up on the site. This adds players from public lists
// that already name them by UUID, through APIs that need no key. The site keeps them
// waiting (POST /api/bot/candidates) and every run of the bot asks Mojang about a few
// hundred; whoever has a profile becomes a player from Mojang's own signed answer, never
// from the list.
//
// The lists, by the name each is handed over under:
//   wynncraft        Wynncraft's player leaderboards, once a day
//   wynncraft-guild  the members of Wynncraft's guilds: some twenty thousand guilds, too
//                    many for one run at Wynncraft's pace, so a slice of them every hour
//                    and all of them every `GUILD_SLICES` hours
//   mcsr             MCSR Ranked: its leaderboard once a day, and the players of every
//                    match played since the run before
//   2b2t             2b2t.vc: who is on the server now, every hour, and its monthly and
//                    all-time tops once a day
// Players who hide their profile on a list come back without a UUID and are left out.
//
// Run every hour by .github/workflows/skin-bot-feed.yml, which the site's hourly cron wakes
// (site/worker/players.ts). Asking again is cheap: the site leaves out everybody it has
// already, and everybody waiting or asked about before.
//
// Usage:
//   node tools/skin-bot-feed.mjs                  this hour's share of every list, handed to the site
//   node tools/skin-bot-feed.mjs --daily          the once-a-day lists too, whatever the hour
//   node tools/skin-bot-feed.mjs --only a,b       only these lists
//   node tools/skin-bot-feed.mjs --dry            fetch and print how many, nothing sent
//
// Read from the environment: SKIN_BOT_KEY (required unless --dry) and SITE_ORIGIN.

const SITE = (process.env.SITE_ORIGIN || 'https://mosaicary.com').replace(/\/+$/, '');
const KEY = (process.env.SKIN_BOT_KEY || '').trim();
const args = process.argv.slice(2);
const dry = args.includes('--dry');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
const AGENT = 'mosaicary-skin-bot (+https://mosaicary.com)';

/** The hour since 1970, UTC: which slice of the guilds is this run's, and whether the daily lists are due. */
const HOUR = Math.floor(Date.now() / 3_600_000);
/** The hour of the day (UTC) the once-a-day lists are fetched in. */
const DAILY_HOUR = 4;
const daily = args.includes('--daily') || HOUR % 24 === DAILY_HOUR;

/** Wynncraft lets a caller without a key make 50 requests a minute; this makes under 40. */
const WYNNCRAFT_GAP = 1600;
/** The longest list Wynncraft hands out in one answer. */
const WYNNCRAFT_ROWS = 1000;
/**
 * Into how many hourly slices the guilds are cut: 19 537 guilds on 2026-10-31, so about 50 a
 * run, some 80 seconds at Wynncraft's pace, and every guild once in sixteen days. The twelve
 * guilds sampled that day had five members on average, so a slice names about 250 players.
 */
const GUILD_SLICES = 16 * 24;
/** MCSR Ranked lets a caller without a key make 500 requests in ten minutes; this makes under 50 a minute. */
const MCSR_GAP = 1300;
/**
 * How far back the matches are read: the hour since the last run, and a little more, since
 * GitHub starts a run up to a few minutes late. About fifteen pages of a hundred an hour
 * (2026-10-31: a hundred matches in four minutes).
 */
const MCSR_SINCE_MS = 75 * 60_000;
/** The most pages of matches one run reads, whatever the hour held. */
const MCSR_PAGES = 40;
/** 2b2t.vc publishes no limit for callers without a key; one request a second is gentle. */
const VC_GAP = 1000;
/** How many UUIDs one POST to the site carries: the most it takes (BOT_CANDIDATES_MOST). */
const POST_SIZE = 1000;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** A GET answered with JSON. A 429 is waited out once, as long as the answer says. */
async function getJson(url) {
  for (let tries = 0; ; tries++) {
    const response = await fetch(url, { headers: { 'user-agent': AGENT } });
    if (response.status === 429 && tries === 0) {
      const wait = Number(response.headers.get('retry-after') || response.headers.get('ratelimit-reset')) || 60;
      await sleep(wait * 1000);
      continue;
    }
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    return response.json();
  }
}

/** A UUID as the site takes it, without dashes and in lower case; null for anything else. */
function uuidOf(value) {
  const uuid = String(value ?? '').replace(/-/g, '').toLowerCase();
  return /^[0-9a-f]{32}$/.test(uuid) ? uuid : null;
}

/** Into `into`, the UUIDs of `rows` (an array, or an object of rows), read with `pick`. */
function collect(into, rows, pick = (row) => row?.uuid) {
  for (const row of Object.values(rows ?? {})) {
    const uuid = uuidOf(pick(row));
    if (uuid) into.add(uuid);
  }
}

/**
 * Every player on Wynncraft's player leaderboards.
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
      collect(uuids, await getJson(`https://api.wynncraft.com/v3/leaderboards/${encodeURIComponent(type)}?resultLimit=${WYNNCRAFT_ROWS}`));
    } catch (why) {
      console.warn(`wynncraft ${type}: ${why.message}`);
    }
  }
  return uuids;
}

/**
 * The members of this hour's slice of Wynncraft's guilds.
 *
 * A guild belongs to the slice its UUID falls in, so the slices stay the same while guilds
 * come and go. The members are listed under their rank (owner, chief, ..., recruit), each
 * by name with a UUID.
 */
async function wynncraftGuilds() {
  const uuids = new Set();
  const all = Object.values(await getJson('https://api.wynncraft.com/v3/guild/list/guild'))
    .map((one) => uuidOf(one?.uuid))
    .filter(Boolean);
  const slice = all.filter((uuid) => parseInt(uuid.slice(-8), 16) % GUILD_SLICES === HOUR % GUILD_SLICES);
  console.log(`wynncraft-guild: slice ${HOUR % GUILD_SLICES} of ${GUILD_SLICES}, ${slice.length} of ${all.length} guilds`);
  for (const guild of slice) {
    await sleep(WYNNCRAFT_GAP);
    try {
      const { members } = await getJson(`https://api.wynncraft.com/v3/guild/uuid/${guild}`);
      for (const [rank, people] of Object.entries(members ?? {})) {
        if (rank !== 'total' && people && typeof people === 'object') collect(uuids, people);
      }
    } catch (why) {
      console.warn(`wynncraft-guild ${guild}: ${why.message}`);
    }
  }
  return uuids;
}

/** The players of MCSR Ranked's matches since the last run, newest first, and its leaderboard on the daily run. */
async function mcsr() {
  const uuids = new Set();
  if (daily) collect(uuids, (await getJson('https://api.mcsrranked.com/leaderboard')).data?.users);
  const since = (Date.now() - MCSR_SINCE_MS) / 1000;
  let before = null;
  for (let page = 0; page < MCSR_PAGES; page++) {
    if (page) await sleep(MCSR_GAP);
    const { data } = await getJson(`https://api.mcsrranked.com/matches?count=100${before ? `&before=${before}` : ''}`);
    if (!Array.isArray(data) || !data.length) break;
    for (const match of data) collect(uuids, match.players);
    before = data[data.length - 1].id;
    if (data[data.length - 1].date < since) break;
  }
  return uuids;
}

/** Who is on 2b2t now, and on the daily run its tops: playtime this month and ever, kills and deaths this month. */
async function vc2b2t() {
  const uuids = new Set();
  collect(uuids, (await getJson('https://api.2b2t.vc/tablist')).players);
  if (!daily) return uuids;
  for (const top of ['playtime/top/month', 'playtime/top', 'kills/top/month', 'deaths/top/month']) {
    await sleep(VC_GAP);
    try {
      collect(uuids, (await getJson(`https://api.2b2t.vc/${top}`)).players);
    } catch (why) {
      console.warn(`2b2t ${top}: ${why.message}`);
    }
  }
  return uuids;
}

/** Each list by the name it is handed to the site under, and whether this run asks it. */
const LISTS = [
  { source: 'wynncraft', due: daily, fetch: wynncraft },
  { source: 'wynncraft-guild', due: true, fetch: wynncraftGuilds },
  { source: 'mcsr', due: true, fetch: mcsr },
  { source: '2b2t', due: true, fetch: vc2b2t },
];

/** One list's UUIDs handed to the site, a thousand at a time: how many were new, and how many wait. */
async function handOver(source, uuids) {
  let added = 0;
  let waiting = 0;
  for (let from = 0; from < uuids.length; from += POST_SIZE) {
    const response = await fetch(`${SITE}/api/bot/candidates`, {
      method: 'POST',
      headers: { 'x-bot-key': KEY, 'user-agent': AGENT, 'content-type': 'application/json' },
      body: JSON.stringify({ source, uuids: uuids.slice(from, from + POST_SIZE) }),
    });
    if (!response.ok) throw new Error(`POST /api/bot/candidates: ${response.status} ${await response.text()}`);
    const said = await response.json();
    added += said.added;
    waiting = said.waiting;
  }
  return { added, waiting };
}

async function main() {
  if (!dry && !KEY) {
    console.error('SKIN_BOT_KEY is not set');
    return 1;
  }
  const lists = LISTS.filter((one) => (only ? only.includes(one.source) : one.due));
  // At once: each list is its own host with its own limit, apart from Wynncraft's two, which
  // go one after the other so as to keep within its one limit per caller.
  const wynn = lists.filter((one) => one.source.startsWith('wynncraft'));
  const rest = lists.filter((one) => !one.source.startsWith('wynncraft'));
  const results = new Map();
  const fetchOne = async (list) => {
    try {
      results.set(list.source, [...(await list.fetch())]);
    } catch (why) {
      console.warn(`${list.source}: ${why.message}`);
    }
  };
  await Promise.all([
    (async () => {
      for (const list of wynn) await fetchOne(list);
    })(),
    ...rest.map(fetchOne),
  ]);
  let refused = false;
  for (const list of lists) {
    const uuids = results.get(list.source);
    if (!uuids) continue;
    if (dry) {
      console.log(`${list.source}: ${uuids.length} players`);
      continue;
    }
    try {
      const said = await handOver(list.source, uuids);
      console.log(`${list.source}: ${uuids.length} players, ${said.added} new to the site, ${said.waiting} waiting for the bot`);
    } catch (why) {
      console.error(`${list.source}: ${why.message}`);
      refused = true;
    }
  }
  return refused ? 1 : 0;
}

// Through `process.exitCode`, as in skin-bot.mjs: Node on Windows aborts when made to exit
// while fetch's connection is closing.
process.exitCode = await main();
