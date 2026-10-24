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
// The work is asked for again after every round, so a name looked for on the site while
// a run is going is picked up within one round rather than at the next run.
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
//                      (tools/skin-tagger.mjs) in whatever time the players leave, and never
//                      in less than the last SKIN_BOT_TAG_MINUTES of a run (default 3, at
//                      most half of it); GEMINI_MODEL picks the model, default
//                      gemini-flash-lite-latest.
//
// Mojang's limits are per address and not published exactly; minecraft.wiki gives about
// 200 requests per two minutes for most of the API and about 400 per ten seconds for
// profiles. This keeps far under both, waits out a 429, and the addresses of GitHub's
// runners are shared with everybody else's jobs, which is one more reason to be slow.

import { readFileSync } from 'node:fs';

const SITE = (process.env.SITE_ORIGIN || 'https://mosaicary.com').replace(/\/+$/, '');
const KEY = (process.env.SKIN_BOT_KEY || '').trim();
const MINUTES = Number(process.env.SKIN_BOT_MINUTES || 8);
const once = process.argv.includes('--once');
const dry = process.argv.includes('--dry');
const seedAt = process.argv.indexOf('--seed');
const seedFile = seedAt >= 0 ? process.argv[seedAt + 1] : null;

const AGENT = 'mosaicary-skin-bot (+https://mosaicary.com)';
/** Pauses between requests to Mojang, in milliseconds. */
const PROFILE_GAP = 300;
const NAMES_GAP = 1000;
/** How long to wait when Mojang says 429 and does not say how long. */
const BACK_OFF = 60_000;
/** How many signed answers go in one report: the site takes at most ten (BOT_PROFILES_MOST). */
const REPORT_SIZE = 10;

const GEMINI_KEY = (process.env.GEMINI_API_KEY || '').trim();
/** The end of a run kept for tagging, in minutes, when there is a key to tag with. */
const TAG_MINUTES = Math.min(Number(process.env.SKIN_BOT_TAG_MINUTES || 3), MINUTES / 2);

const deadline = Date.now() + MINUTES * 60_000;
// The players stop short of the end when there is tagging to do. An open list of thirteen
// thousand players is work that does not run out within a run, and with the players taking
// all of it no skin found meanwhile was ever named or tagged: the shelf filled with
// "Skin 3f2a9c1b" and a category filter that found nothing.
const playersUntil = GEMINI_KEY && !dry ? deadline - TAG_MINUTES * 60_000 : deadline;
const timeLeft = () => Date.now() < playersUntil;
const taggingLeft = () => Date.now() < deadline;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const tally = { rounds: 0, names: 0, found: 0, missing: 0, profiles: 0, gone: 0, sent: 0, refused: 0, skins: 0, skinsRefused: 0, tagged: 0, refusedLooks: 0 };

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

/** A request to Mojang, waiting out 429s. Null for an answer with nothing in it. */
async function mojang(url, init = {}) {
  for (let tries = 0; tries < 5; tries++) {
    const response = await fetch(url, { ...init, headers: { 'user-agent': AGENT, ...(init.headers ?? {}) } });
    if (response.status === 429) {
      const wait = Number(response.headers.get('retry-after')) * 1000 || BACK_OFF;
      console.log(`Mojang said 429, waiting ${Math.round(wait / 1000)} s`);
      await sleep(wait);
      continue;
    }
    if (response.status === 204 || response.status === 404) return null;
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    return response.json();
  }
  throw new Error(`${url}: still 429 after five tries`);
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

/** The skin files the site still needs: each fetched from Mojang and handed over. */
async function sendSkins(hashes) {
  for (const hash of hashes) {
    const response = await fetch(`https://textures.minecraft.net/texture/${hash}`, { headers: { 'user-agent': AGENT } });
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

/** One round: the work, Mojang's answers, the reports, the files. False when there was nothing new to do. */
async function round(seen, extra = []) {
  const work = await site('/api/bot/work');
  const asked = [...work.names, ...extra.filter((name) => !work.names.some((one) => one.toLowerCase() === name.toLowerCase()))];
  const names = asked.filter((name) => !seen.has(`name:${name.toLowerCase()}`));
  // Players to check again, then players a list named whom the site has never asked about:
  // the second come last, so a run that runs out of time leaves them and not the checks.
  const players = [...work.players, ...(work.candidates ?? [])].filter((uuid) => !seen.has(uuid));
  if (dry) {
    console.log(JSON.stringify({ names, players }, null, 2));
    return false;
  }
  if (!names.length && !players.length) return false;
  tally.rounds++;
  for (const name of names) seen.add(`name:${name.toLowerCase()}`);

  const answered = await resolve(names);
  const uuids = [...new Set([...answered.flatMap((one) => (one.uuid ? [one.uuid] : [])), ...players])];
  let pendingNames = answered;
  let batch = [];
  let gone = [];

  const flush = async () => {
    if (!batch.length && !pendingNames.length && !gone.length) return;
    const said = await site('/api/bot/report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ names: pendingNames, profiles: batch, gone }),
    });
    tally.sent += said.taken;
    tally.refused += said.refused;
    pendingNames = [];
    batch = [];
    gone = [];
    if (said.need.length) await sendSkins(said.need);
  };

  for (const uuid of uuids) {
    if (!timeLeft()) break;
    seen.add(uuid);
    try {
      const profile = await profileOf(uuid);
      tally.profiles++;
      if (profile) batch.push(profile);
      else {
        gone.push(uuid);
        tally.gone++;
      }
    } catch (why) {
      console.warn(`player ${uuid}: ${why.message}`);
    }
    if (batch.length >= REPORT_SIZE) await flush();
    await sleep(PROFILE_GAP);
  }
  await flush();
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
  while (timeLeft()) {
    const worked = await round(seen, extra);
    extra = [];
    if (!worked || once) break;
  }
  if (GEMINI_KEY && !dry) await tagFound();
  console.log(
    `rounds ${tally.rounds}; names ${tally.names} (found ${tally.found}, missing ${tally.missing}); ` +
      `profiles ${tally.profiles} (gone ${tally.gone}); kept ${tally.sent}, refused ${tally.refused}; ` +
      `skins sent ${tally.skins}, refused ${tally.skinsRefused}; tagged ${tally.tagged}, taken down ${tally.refusedLooks}`,
  );
  return 0;
}

/**
 * Found skins the tagger has not judged yet, tagged and checked with what is left of the run
 * (tools/skin-tagger.mjs): the never tagged, and the tagged before the tagger was asked about
 * safety. The site takes down what the check refuses.
 *
 * After the players and not before: a name somebody is waiting for matters more than a tag.
 * But never with nothing left: the players stop `TAG_MINUTES` before the end (see above).
 * Newest first, so a skin found this run is checked this run when there is time; the rest
 * wait for the next. Without GEMINI_API_KEY nothing is tagged or checked.
 */
async function tagFound() {
  const { readPng, look, askGemini } = await import('./skin-tagger.mjs');
  const model = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';
  const pause = model.includes('lite') ? 4500 : 6500;
  const { skins } = await site('/api/bot/unchecked');
  for (const skin of skins) {
    if (!taggingLeft()) return;
    try {
      const png = readPng(new Uint8Array(await (await fetch(`${SITE}/api/skins/${skin.id}.png?for=view`)).arrayBuffer()));
      const answer = await askGemini(look(png, skin.version === 'slim'), { key: GEMINI_KEY, model, tries: 1 });
      if (answer.tags.length || answer.safety) {
        await site(`/api/bot/skins/${skin.id}/look`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ category: answer.category, tags: answer.tags, name: answer.title, safety: answer.safety }),
        });
        tally.tagged++;
        if (answer.safety && answer.safety !== 'ok') {
          tally.refusedLooks++;
          console.log(`taken down ${skin.id}: ${answer.safety}`);
        }
      }
    } catch (why) {
      console.warn(`tagging ${skin.id}: ${why.message}`);
    }
    await sleep(pause);
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
