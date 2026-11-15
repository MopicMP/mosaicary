// The skin bot: asks Mojang what players wear and hands the answers to the site.
//
// Why a bot at all: Mojang tells nobody when somebody changes their skin. The only way
// to know is to ask about one player at a time, which is what NameMC does whenever its
// page for a player is opened (docs/namemc-research.md). Mojang answers 403 to a
// Cloudflare Worker, so the asking happens here, in GitHub Actions, and the site gets
// the answers.
//
// Why it is trusted with nothing: every answer it passes on is Mojang's own signed
// `textures` property (`?unsigned=false`), and the site checks the signature with
// Mojang's public key before keeping a word of it (site/worker/players.ts). Who, under
// which name, wearing which skin and when are all read from inside the signature. A
// skin file is taken only for a hash a signed answer named, and only if it hashes to
// it. The one thing taken on this program's word is that a name has no player.
//
// What one run does, until the work runs out or the time is up:
//   1. GET  /api/bot/work            names somebody looked for, players due a check, and
//                                    players an open list named (tools/skin-bot-feed.mjs)
//   2. Mojang: names -> UUIDs, ten at a time; then each player's signed profile
//   3. POST /api/bot/report          the signed answers, ten to a report, and the names
//   4. PUT  /api/bot/textures/<hash> every skin file the site says it still needs
//   5. POST /api/bot/release         the players a list named that the round did not get to,
//                                    so they wait again and the site's day counts only those
//                                    asked about (docs/defense/skin-intake-2026-11-15.md)
// The players due a check and those a list named take turns, so a round that runs out of time
// leaves some of each. Names looked for on the site meanwhile are asked for every
// `NAMES_POLL` (/api/bot/work?only=names) and answered first, so a long round keeps nobody
// waiting for it to end.
//
// Usage:
//   node tools/skin-bot.mjs           work until there is nothing left or the time is up
//   node tools/skin-bot.mjs --once    one round only
//   node tools/skin-bot.mjs --dry     print the work and ask Mojang nothing
//   node tools/skin-bot.mjs --seed F  also look up every name in file F in the first round
//                                     (tools/skin-bot-seed.txt: the players the site starts from)
//
// Read from the environment:
//   SKIN_BOT_KEY       the site's key for these routes (x-bot-key). Required.
//   SITE_ORIGIN        where the site is, default https://mosaicary.com
//   SKIN_BOT_MINUTES   how long a run may work, default 8. The workflow stops a run at 15.
//   GEMINI_API_KEY     optional: with it, found skins that have no tags are tagged and named
//                      (tools/skin-tagger.mjs) for the whole run, alongside the players,
//                      SKIN_BOT_TAG_WORKERS skins at a time (default 4), each in a request
//                      of its own; GEMINI_MODELS lists the models to ask in turn, default
//                      `LOOKERS` in tools/skin-tagger.mjs: when one has spent its free day,
//                      the next one checks.
//   GEMINI_API_KEY2    optional: another key, its models asked alongside the first key's. When
//                      Gemini refuses a key the others go on, the run page says so and the site
//                      sends a mail; when it refuses them all the run fails as well.
//   CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_AI_TOKEN
//                      optional: with both, every skin found in the run is asked at once
//                      whether it has a photo of a real person on it (Workers AI's
//                      clef-flash, `askPhoto` in tools/skin-tagger.mjs), and taken down if
//                      so, without waiting for its turn with Gemini. Within
//                      `PHOTO_NEURONS_A_DAY`, under the free allowance: the token needs
//                      Workers AI and Account Analytics (read), to see the day's spending.
//
// Mojang's limits are per address and not published exactly; minecraft.wiki gives about
// 200 requests per two minutes for most of the API and about 400 per ten seconds for
// profiles. This keeps far under both, waits out a 429, and the addresses of GitHub's
// runners are shared with everybody else's jobs, which is one more reason to be slow: after
// each 429 it asks less often, up to `MOST_GAP`, and a little faster again with each answer.
//
// A 429 from the session server is brief. Measured 2026-11-16 from one address: one profile every
// half second was refused 20 times in 90 s and the next request half a second later was answered
// nearly every time; one a second, twice in a minute. Waiting a whole minute on each, as this did
// until then, cost seven of a run's ten minutes on a busy day and the day most of its new players
// (docs/defense/skin-intake-2026-11-15.md in the site's project). So the waits grow from seconds
// (`BACK_OFFS`), and a minute only when Mojang keeps refusing the same request.

import { readFileSync } from 'node:fs';

const SITE = (process.env.SITE_ORIGIN || 'https://mosaicary.com').replace(/\/+$/, '');
const KEY = (process.env.SKIN_BOT_KEY || '').trim();
const MINUTES = Number(process.env.SKIN_BOT_MINUTES || 8);
const once = process.argv.includes('--once');
const dry = process.argv.includes('--dry');
const seedAt = process.argv.indexOf('--seed');
const seedFile = seedAt >= 0 ? process.argv[seedAt + 1] : null;

const AGENT = 'mosaicary-skin-bot (+https://mosaicary.com)';
/** Pauses between requests to Mojang, in milliseconds: the least, and the most a run of 429s makes it. */
const PROFILE_GAP = 300;
const MOST_GAP = 2_000;
/** The pause between profiles now: longer after a 429, back towards `PROFILE_GAP` with every answer. */
let gap = PROFILE_GAP;
/** How often a long round asks whether somebody looked a name up meanwhile. */
const NAMES_POLL = 45_000;
const NAMES_GAP = 1000;
/** How long to wait when Mojang says 429 and does not say how long, try by try of the same request. */
const BACK_OFFS = [2_000, 5_000, 15_000, 30_000, 60_000];
/** How many signed answers go in one report: the site takes at most ten (BOT_PROFILES_MOST). */
const REPORT_SIZE = 10;

const GEMINI_KEY = (process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY2 || '').trim();
/**
 * How many skins are being asked about at once. Never in one request: asked in a batch, the
 * models missed the photo they caught when asked about it alone (docs/skin-bot-plan.md).
 * One at a time, though, a run spent most of its minutes waiting on answers of 2 to 6 seconds
 * while the pace of three models allowed one every 1.5 seconds between them.
 */
const TAG_WORKERS = Math.max(1, Number(process.env.SKIN_BOT_TAG_WORKERS || 4));
/** How often the work is asked for again while there is none, so a name looked up meanwhile is answered within the run. */
const WORK_POLL = 30_000;

const CF_ACCOUNT = (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
const CF_AI_TOKEN = (process.env.CLOUDFLARE_AI_TOKEN || '').trim();

const deadline = Date.now() + MINUTES * 60_000;
// The players and the tagging share the whole run: Mojang's pace holds the one and Gemini's the
// other, so neither waits for the other. Run one after the other, an open list of thousands of
// players took every minute, and no skin found meanwhile was named or checked.
const timeLeft = () => Date.now() < deadline;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
/** A pause of `ms`, cut short by the end of the run. */
const pause = (ms) => sleep(Math.max(0, Math.min(ms, deadline - Date.now())));

/** Where the players stand, for the tagging to know whether more found skins may still come this run. */
const playerWork = { idle: false, done: false };
/** Whether the tagging is over for this run: every model's day spent, or nothing left to check. */
let taggingOver = !GEMINI_KEY || dry;

const tally = { graded: 0, rounds: 0, names: 0, found: 0, missing: 0, profiles: 0, gone: 0, released: 0, sent: 0, refused: 0, skins: 0, skinsRefused: 0, tagged: 0, refusedLooks: 0, lookers: '', photosAsked: 0, photosDown: 0 };

class Stop extends Error {}

/** How long to wait before asking the site again after it failed, try by try. */
const SITE_RETRIES = [5_000, 15_000];

/**
 * A request to the site, with the key.
 *
 * A dropped connection or a 5xx is asked again, twice, before the run stops: one bad answer
 * among the thousands of a long run should not cost the rest of it. Asking again is safe,
 * since every bot route can take the same request twice (a signed answer is kept by its
 * signed time, a file already there is "already", a UUID already waiting is left alone).
 * Anything else that is not 2xx stops the run at once.
 */
async function site(path, init = {}) {
  for (let tries = 0; ; tries++) {
    let response;
    try {
      response = await fetch(`${SITE}${path}`, {
        ...init,
        headers: { 'x-bot-key': KEY, 'user-agent': AGENT, ...(init.headers ?? {}) },
      });
    } catch (why) {
      if (tries >= SITE_RETRIES.length) throw new Stop(`${init.method ?? 'GET'} ${path}: ${why.message}`);
      console.warn(`${init.method ?? 'GET'} ${path}: ${why.message}; asking again`);
      await sleep(SITE_RETRIES[tries]);
      continue;
    }
    if (response.status === 404 && path === '/api/bot/work') {
      throw new Stop('the site answered 404: SKIN_BOT_KEY is wrong, or not set on the site');
    }
    if (response.status >= 500 && tries < SITE_RETRIES.length) {
      console.warn(`${init.method ?? 'GET'} ${path}: ${response.status}; asking again`);
      await sleep(SITE_RETRIES[tries]);
      continue;
    }
    if (!response.ok) throw new Stop(`${init.method ?? 'GET'} ${path}: ${response.status} ${await response.text()}`);
    return response.json();
  }
}

/** How long to wait before asking Mojang's side again after the connection itself failed. */
const NET_RETRIES = [3_000, 10_000];

/**
 * A fetch from Mojang's side that asks again when the connection itself fails, a few seconds
 * apart. Its servers stand on Microsoft's network, and a connection there now and then times
 * out (ETIMEDOUT to 150.171.109.x, 2026-10-29 and 10-30): once, that ended the whole run.
 */
async function fetchAgain(url, init = {}) {
  for (let tries = 0; ; tries++) {
    try {
      return await fetch(url, init);
    } catch (why) {
      if (tries >= NET_RETRIES.length) throw why;
      console.warn(`${url}: ${why.cause?.code ?? why.message}; asking again`);
      await sleep(NET_RETRIES[tries]);
    }
  }
}

/** A request to Mojang, waiting out 429s. Null for an answer with nothing in it. */
async function mojang(url, init = {}) {
  for (let tries = 0; tries < BACK_OFFS.length; tries++) {
    const response = await fetchAgain(url, { ...init, headers: { 'user-agent': AGENT, ...(init.headers ?? {}) } });
    if (response.status === 429) {
      const wait = Number(response.headers.get('retry-after')) * 1000 || BACK_OFFS[tries];
      gap = Math.min(MOST_GAP, Math.round(gap * 1.5));
      console.log(`Mojang said 429, waiting ${Math.round(wait / 1000)} s, then one every ${gap} ms`);
      // Cut short by the end of the run: what is left is handed back, not waited for.
      await pause(wait);
      if (!timeLeft()) throw new Error(`${url}: 429, and the run's time is up`);
      continue;
    }
    gap = Math.max(PROFILE_GAP, Math.round(gap * 0.95));
    if (response.status === 204 || response.status === 404) return null;
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    return response.json();
  }
  throw new Error(`${url}: still 429 after ${BACK_OFFS.length} tries`);
}

/** Names to UUIDs, ten at a time. A name Mojang leaves out of its answer has no player. */
async function resolve(names) {
  const results = [];
  for (let at = 0; at < names.length && timeLeft(); at += 10) {
    const part = names.slice(at, at + 10);
    let answer;
    try {
      answer = await mojang('https://api.minecraftservices.com/minecraft/profile/lookup/bulk/byname', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(part),
      });
    } catch (why) {
      // Left unanswered rather than reported missing: the site keeps them for the next round.
      console.warn(`names ${part.join(', ')}: ${why.message}`);
      continue;
    }
    const byName = new Map((answer ?? []).map((one) => [String(one.name).toLowerCase(), String(one.id)]));
    for (const name of part) {
      const uuid = byName.get(name.toLowerCase()) ?? null;
      results.push({ name, uuid });
      tally.names++;
      if (uuid) tally.found++;
      else tally.missing++;
    }
    await sleep(NAMES_GAP);
  }
  return results;
}

/** A player's signed `textures` property, or null when the account is gone. */
async function profileOf(uuid) {
  const answer = await mojang(`https://sessionserver.mojang.com/session/minecraft/profile/${uuid}?unsigned=false`);
  const textures = answer?.properties?.find((one) => one.name === 'textures');
  return textures?.signature ? { value: textures.value, signature: textures.signature } : null;
}

/**
 * Which skins the signed answers say are worn slim, by texture hash: the `metadata.model` of
 * the SKIN in each answer's `textures` (base64 JSON). Only for drawing the picture the photo
 * question gets; the site decides a skin's arms for itself.
 */
function slimOf(profiles) {
  const slim = new Set();
  for (const profile of profiles) {
    try {
      const skin = JSON.parse(Buffer.from(profile.value, 'base64').toString('utf8')).textures?.SKIN;
      const hash = String(skin?.url ?? '').split('/').pop();
      if (hash && skin?.metadata?.model === 'slim') slim.add(hash);
    } catch {
      // A value that does not read is the site's to refuse; here it is just not slim.
    }
  }
  return slim;
}

/** The photo question's state for the run: the tagger's functions and the day's budget, made at first use. */
let photos = null;

/**
 * A skin found this run, asked whether it has a photo of a real person on it, and taken
 * down when clef-flash says so (`PHOTO_AT`). Anything else leaves it as it was, unchecked,
 * for Gemini. Without Cloudflare's account and token, or with the day's budget spent, the
 * question is not asked.
 */
async function photoCheck(model, bytes, slim) {
  if (!CF_ACCOUNT || !CF_AI_TOKEN) return;
  if (!photos) {
    const tagger = await import('./skin-tagger.mjs');
    const budget = await tagger.photoBudget({ account: CF_ACCOUNT, token: CF_AI_TOKEN });
    photos = { ...tagger, budget, stopped: false };
    console.log(
      Number.isFinite(budget.spentBefore)
        ? `photo check: Workers AI spent ${Math.round(budget.spentBefore)} of ${tagger.PHOTO_NEURONS_A_DAY} neurons today before this run`
        : 'photo check: could not read what Workers AI spent today, so no photo questions this run',
    );
  }
  if (!photos.budget.allows()) {
    if (!photos.stopped) console.log("photo check: the day's neurons are spent; the rest wait for Gemini");
    photos.stopped = true;
    return;
  }
  try {
    const picture = photos.look(photos.readPng(bytes), slim);
    const yes = await photos.askPhoto(picture, { account: CF_ACCOUNT, token: CF_AI_TOKEN, budget: photos.budget });
    tally.photosAsked++;
    if (yes === null || yes < photos.PHOTO_AT) return;
    await site(`/api/bot/skins/${model}/look`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ safety: 'photo' }),
    });
    tally.photosDown++;
    console.log(`taken down ${model}: photo (${yes.toFixed(2)})`);
  } catch (why) {
    console.warn(`photo check ${model}: ${why.message}`);
  }
}

/** The skin files the site still needs: each fetched from Mojang and handed over. */
async function sendSkins(hashes, slim = new Set()) {
  for (const hash of hashes) {
    let response;
    try {
      response = await fetchAgain(`https://textures.minecraft.net/texture/${hash}`, { headers: { 'user-agent': AGENT } });
    } catch (why) {
      // Left for the next report, which names the files still missing again.
      console.warn(`skin ${hash}: textures.minecraft.net did not answer (${why.cause?.code ?? why.message})`);
      continue;
    }
    if (!response.ok) {
      console.warn(`skin ${hash}: textures.minecraft.net answered ${response.status}`);
      continue;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const said = await site(`/api/bot/textures/${hash}`, {
      method: 'PUT',
      headers: { 'content-type': 'image/png', 'content-length': String(bytes.length) },
      body: bytes,
    });
    if (said.refused) {
      tally.skinsRefused++;
      console.log(`skin ${hash}: refused (${said.refused})`);
    } else {
      tally.skins++;
      // A found skin (nobody published this drawing), new to the site with this file.
      if (said.model && said.authored === false && !said.already) await photoCheck(said.model, bytes, slim.has(hash));
    }
  }
}

/** The names of a seed file: one per line, `#` starting a comment, held to the shape of a name. */
function seedNames(file) {
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*/, '').trim())
    .filter((line) => /^[A-Za-z0-9_]{1,16}$/.test(line));
}

/** Two lists one from each in turn, the rest of the longer one after. */
function inTurn(one, other) {
  const out = [];
  for (let at = 0; at < Math.max(one.length, other.length); at++) {
    if (at < one.length) out.push(one[at]);
    if (at < other.length) out.push(other[at]);
  }
  return out;
}

/** A list's players handed out and not asked about, back to the site: waiting again, off the day's count. */
async function handBack(candidates) {
  const said = await site('/api/bot/release', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ candidates }),
  });
  tally.released += said.released;
}

/** Names looked for on the site since the round began, answered: their UUIDs go to the front of the round. */
async function namesMeanwhile(seen) {
  const work = await site('/api/bot/work?only=names');
  const names = work.names.filter((name) => !seen.has(`name:${name.toLowerCase()}`));
  for (const name of names) seen.add(`name:${name.toLowerCase()}`);
  return names.length ? resolve(names) : [];
}

/** One round: the work, Mojang's answers, the reports, the files. False when there was nothing new to do. */
async function round(seen, extra = []) {
  const work = await site('/api/bot/work');
  const asked = [...work.names, ...extra.filter((name) => !work.names.some((one) => one.toLowerCase() === name.toLowerCase()))];
  const names = asked.filter((name) => !seen.has(`name:${name.toLowerCase()}`));
  // The players due a check and those a list named, in turn: one waiting for the other spent the
  // whole run on the checks whenever Mojang was slow, and the day's new players with it.
  const candidates = work.candidates ?? [];
  const players = inTurn(work.players, candidates).filter((uuid) => !seen.has(uuid));
  if (dry) {
    console.log(JSON.stringify({ names, players }, null, 2));
    // Asking for work took the list's players: a run that asks Mojang nothing hands them all back.
    if (candidates.length) await handBack(candidates);
    return false;
  }
  if (!names.length && !players.length) return false;
  tally.rounds++;
  for (const name of names) seen.add(`name:${name.toLowerCase()}`);

  // The candidates Mojang answered for this round; the rest are handed back at its end.
  const answeredFor = new Set();
  try {
    const answered = await resolve(names);
    const queue = [...new Set([...answered.flatMap((one) => (one.uuid ? [one.uuid] : [])), ...players])];
    let pendingNames = answered;
    let batch = [];
    let gone = [];
    let namesAt = Date.now();

    const flush = async () => {
      if (!batch.length && !pendingNames.length && !gone.length) return;
      const said = await site('/api/bot/report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ names: pendingNames, profiles: batch, gone }),
      });
      tally.sent += said.taken;
      tally.refused += said.refused;
      const slim = slimOf(batch);
      pendingNames = [];
      batch = [];
      gone = [];
      if (said.need.length) await sendSkins(said.need, slim);
    };

    while (queue.length && timeLeft()) {
      if (Date.now() - namesAt >= NAMES_POLL) {
        namesAt = Date.now();
        const more = await namesMeanwhile(seen);
        pendingNames.push(...more);
        queue.unshift(...more.flatMap((one) => (one.uuid && !seen.has(one.uuid) ? [one.uuid] : [])));
      }
      const uuid = queue.shift();
      if (seen.has(uuid)) continue;
      seen.add(uuid);
      try {
        const profile = await profileOf(uuid);
        tally.profiles++;
        answeredFor.add(uuid);
        if (profile) batch.push(profile);
        else {
          gone.push(uuid);
          tally.gone++;
        }
      } catch (why) {
        console.warn(`player ${uuid}: ${why.message}`);
      }
      // The site takes at most REPORT_SIZE of each in one report, the gone included: the end of an
      // old list is many accounts in a row that no longer exist, and a report carrying more of
      // them than that was refused, which ended the run (2026-10-28, four runs in a row).
      if (batch.length >= REPORT_SIZE || gone.length >= REPORT_SIZE) await flush();
      await sleep(gap);
    }
    await flush();
  } finally {
    // Whatever of the list's players the round did not get to waits again, off the day's count.
    const left = candidates.filter((uuid) => !answeredFor.has(uuid));
    if (left.length) await handBack(left);
  }
  return true;
}

async function main() {
  if (!KEY) throw new Stop('SKIN_BOT_KEY is not set');
  console.log(`site ${SITE}, up to ${MINUTES} min${once ? ', one round' : ''}${dry ? ', dry run' : ''}`);
  // Everything handled in this run, so a player Mojang could not answer for is not asked
  // about again and again while the site still lists them as due.
  const seen = new Set();
  // The seed goes into the first round only: every name in it is a lookup like a person's,
  // and the rounds after it carry on with what the site asks for.
  let extra = seedFile ? seedNames(seedFile) : [];
  if (seedFile) console.log(`seed: ${extra.length} names from ${seedFile}`);
  // Held, not awaited, so the players go on meanwhile; a failure stops the run after them.
  const tagging = taggingOver ? Promise.resolve(null) : tagFound().then(() => null, (why) => why);
  try {
    while (timeLeft()) {
      const worked = await round(seen, extra);
      extra = [];
      playerWork.idle = !worked;
      if (once || dry) break;
      if (worked) continue;
      // Nothing to do now. While the tagging goes on, the work is asked for again, so a name
      // somebody looks up meanwhile is answered in this run and not after it.
      if (taggingOver) break;
      await pause(WORK_POLL);
    }
  } finally {
    playerWork.done = true;
  }
  const failed = await tagging;
  if (failed) throw failed;
  console.log(
    `rounds ${tally.rounds}; names ${tally.names} (found ${tally.found}, missing ${tally.missing}); ` +
      `profiles ${tally.profiles} (gone ${tally.gone}); kept ${tally.sent}, refused ${tally.refused}; handed back ${tally.released}; ` +
      `skins sent ${tally.skins}, refused ${tally.skinsRefused}; photo check ${tally.photosAsked}, taken down ${tally.photosDown}; ` +
      `tagged ${tally.tagged}${tally.lookers ? ` (${tally.lookers})` : ''}, taken down ${tally.refusedLooks}, graded ${tally.graded}`,
  );
  return 0;
}

/**
 * Skins the tagger has not judged yet, tagged and checked for the whole run
 * (tools/skin-tagger.mjs): the published ones first, then the found ones never tagged, and the
 * tagged before the tagger was asked about safety. The site takes down what the check refuses.
 *
 * `TAG_WORKERS` at a time, sharing the models' pace (`askAny`), alongside the players. The
 * list is asked for again whenever it runs out, newest first, so a skin found this run is
 * checked this run when the models allow. Without GEMINI_API_KEY nothing is tagged or checked.
 */
async function tagFound() {
  const { readPng, look, closeup, lookersOf, askAny, keysGone, graderOf } = await import('./skin-tagger.mjs');
  const everyLooker = lookersOf(process.env);
  // One model is held back while checked skins wait for a grade, and comes back to the checks after.
  const grader = graderOf(everyLooker);
  const toGrade = grader ? (await site('/api/bot/ungraded?limit=1').catch(() => ({ skins: [] }))).skins.length > 0 : false;
  const lookers = toGrade ? everyLooker.filter((one) => one !== grader) : everyLooker;
  // Every skin handed to a worker this run: the list asked for again still has the ones being
  // asked about, and one that failed waits for the next run rather than coming round again.
  const taken = new Set();
  let waiting = [];
  let asking = null;

  /** The next skin nobody in this run has had, or null when the site has none for now. */
  async function next() {
    if (!waiting.length) {
      asking ??= site('/api/bot/unchecked')
        .then(({ skins }) => {
          waiting = skins.filter((one) => !taken.has(one.id));
        })
        .finally(() => {
          asking = null;
        });
      await asking;
    }
    const skin = waiting.shift() ?? null;
    if (skin) taken.add(skin.id);
    return skin;
  }

  async function worker() {
    while (!taggingOver && timeLeft()) {
      const skin = await next();
      if (!skin) {
        // More can come only from the players, and only while they still have work.
        if (playerWork.idle || playerWork.done) return;
        await pause(WORK_POLL);
        continue;
      }
      if (!(await tagOne(skin))) {
        if (!taggingOver && lookers.every((one) => one.spent) && !lookers.every((one) => one.refused)) console.log('every model has spent its free day; the rest wait for tomorrow');
        taggingOver = true;
      }
    }
  }

  try {
    await Promise.all([...Array.from({ length: TAG_WORKERS }, worker), ...(toGrade ? [gradeChecked(grader)] : [])]);
  } finally {
    taggingOver = true;
    tally.lookers = everyLooker.filter((one) => one.answered).map((one) => `${one.name} ${one.answered}`).join(', ');
  }

  // One key gone leaves the others working, so the run stays green with a notice on its page and
  // the site says so by mail, once a day for each key. With none left no skin can be checked, and
  // the run fails as well.
  const refused = lookers.filter((one) => one.refused);
  if (refused.length) console.log(`::warning::Gemini refused the key for ${refused.map((one) => one.name).join(', ')}`);
  const gone = keysGone(lookers);
  const left = new Set(lookers.map((one) => one.keyNumber)).size - gone.length;
  for (const key of gone) {
    await site('/api/bot/key-refused', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, left }) }).catch((why) =>
      console.warn(`the site was not told about key ${key}: ${why.message}`),
    );
  }
  if (gone.length && !left) throw new Error('Gemini refused every key: no skin can be checked until there is a working one');

  /** One skin asked and written; false when no model will answer before the run ends. */
  async function tagOne(skin) {
    try {
      const png = readPng(new Uint8Array(await (await fetch(`${SITE}/api/skins/${skin.id}.png?for=view`)).arrayBuffer()));
      const slim = skin.version === 'slim';
      const asked = await askAny(lookers, look(png, slim), { until: deadline, close: closeup(png, slim) });
      if (!asked) return false;
      const answer = asked.answer;
      if (answer.tags.length || answer.safety) {
        const said = await site(`/api/bot/skins/${skin.id}/look`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ category: answer.category, tags: answer.tags, name: answer.title, safety: answer.safety, quality: answer.quality, by: asked.model }),
        });
        tally.tagged++;
        // A skin a person published is never taken down by the bot: the site puts it in the
        // review queue instead (`dressPublished` in site/worker/players.ts).
        if (said?.review) console.log(`sent to review ${skin.id}: ${answer.safety}`);
        else if (answer.safety && answer.safety !== 'ok') {
          tally.refusedLooks++;
          console.log(`taken down ${skin.id}: ${answer.safety}`);
        }
      }
    } catch (why) {
      console.warn(`tagging ${skin.id}: ${why.message}`);
    }
    return true;
  }

  /**
   * The skins checked before the grade was asked for, a picture of four at a time on `looker`'s own
   * allowance, for as long as the run and the allowance last. A skin that got no grade waits for
   * the next run rather than coming round again in this one.
   */
  async function gradeChecked(looker) {
    const { gradeSheet, askGrades, gradesSource, GRADES_PER_PICTURE } = await import('./skin-tagger.mjs');
    const taken = new Set();
    let waiting = [];
    while (timeLeft() && !looker.spent) {
      if (waiting.length < GRADES_PER_PICTURE) {
        const { skins } = await site(`/api/bot/ungraded?limit=${GRADES_PER_PICTURE * 10}`);
        waiting = skins.filter((one) => !taken.has(one.id));
        if (!waiting.length) return;
      }
      const group = waiting.splice(0, GRADES_PER_PICTURE);
      for (const one of group) taken.add(one.id);
      try {
        const files = await Promise.all(
          group.map(async (skin) => ({
            png: readPng(new Uint8Array(await (await fetch(`${SITE}/api/skins/${skin.id}.png?for=view`)).arrayBuffer())),
            slim: skin.version === 'slim',
          })),
        );
        const sheet = gradeSheet(files);
        const asked = await askAny([looker], sheet, {
          until: deadline,
          ask: ({ key, model }) => askGrades(sheet, { key, model, count: group.length }),
        });
        if (!asked) return;
        const grades = group.map((skin, at) => ({ id: skin.id, quality: asked.answer[at] })).filter((one) => one.quality !== null);
        if (grades.length) {
          await site('/api/bot/grades', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ by: gradesSource(asked.model), grades }),
          });
          tally.graded += grades.length;
        }
      } catch (why) {
        console.warn(`grading ${group.map((one) => one.id).join(' ')}: ${why.message}`);
      }
    }
  }
}

// Exits through `process.exitCode` rather than `process.exit()`: on Windows, Node aborts
// with a libuv assertion when it is made to exit while fetch's connection is closing.
try {
  process.exitCode = await main();
} catch (error) {
  if (!(error instanceof Stop)) throw error;
  console.error(error.message);
  process.exitCode = 1;
}
