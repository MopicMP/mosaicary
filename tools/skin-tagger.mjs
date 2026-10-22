// The skin tagger: a category, tags from a fixed list and a title for a skin, from the
// picture alone.
//
// Why a list: tags are only worth having if the next skin gets the same word for the same
// thing. A model left to invent words gives "knight", "knights", "medieval knight" and
// "paladin" to four knights; here it may only choose, and anything not on the list is
// dropped. The list is English, as every tag on the site is (site rules, `tags-english`).
//
// How: the skin is drawn worn, front and back side by side, at ten pixels to a skin pixel
// (`look`), and that picture goes to Gemini with the list and the four skin categories of
// the site. The answer is JSON; whatever in it is not on the list is thrown away here, so
// nothing the model makes up reaches the site.
//
// Usage:
//   node tools/skin-tagger.mjs --site URL --dry DIR [--limit N]
//       tag the found skins of a site without writing anything: the pictures and the
//       answers go to DIR, for a person to look through before anything is trusted
//   node tools/skin-tagger.mjs --site URL --write [--limit N]
//       tag the found skins that have no tags yet and write them through the bot's route
//
// Read from the environment:
//   GEMINI_API_KEY    the key for Google's Gemini API. Required.
//   GEMINI_MODEL      the model, default gemini-flash-lite-latest (the current light model)
//   SKIN_BOT_KEY      the site's bot key, for --write
//
// Gemini's free tier allows about fifteen requests a minute to this model, so requests go
// out one at a time with a pause between them, and a 429 is waited out.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';

/** The tags a skin may get. Lower case English, as the site keeps tags. */
export const SKIN_TAGS = [
  // How it looks
  'cute', 'cool', 'dark', 'aesthetic', 'anime', 'cartoon', 'realistic', 'retro', 'emo', 'goth', 'punk', 'kawaii',
  // Who it is
  'knight', 'warrior', 'ninja', 'samurai', 'pirate', 'wizard', 'witch', 'vampire', 'zombie', 'skeleton', 'demon',
  'angel', 'elf', 'fairy', 'robot', 'cyborg', 'alien', 'ghost', 'clown', 'prince', 'princess', 'king', 'queen',
  'soldier', 'police', 'doctor', 'chef', 'astronaut', 'superhero', 'villain', 'scientist', 'farmer', 'miner',
  'cowboy', 'assassin', 'hunter', 'gamer', 'student', 'business',
  // Creatures
  'animal', 'cat', 'dog', 'fox', 'wolf', 'bear', 'rabbit', 'dragon', 'creeper', 'enderman', 'monster', 'mob',
  // What it wears
  'hoodie', 'suit', 'dress', 'skirt', 'armor', 'jacket', 'cape', 'cloak', 'uniform', 'mask', 'hat', 'cap', 'hood',
  'headphones', 'glasses', 'crown', 'horns', 'wings', 'tail', 'ears', 'scarf', 'tie', 'overalls', 'sweater',
  // Hair
  'blonde', 'redhead', 'long hair',
  // Themes
  'halloween', 'christmas', 'summer', 'winter', 'sci-fi', 'fantasy', 'medieval', 'steampunk', 'military', 'sports',
  'nature', 'space',
  // Main colours
  'black', 'white', 'red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'brown', 'gray', 'rainbow',
];

/** The site's four skin categories, as the site says them (shared/modelRules.ts). */
export const SKIN_CATEGORIES = ['girls', 'boys', 'characters', 'creatures'];

const PROMPT = `You tag Minecraft player skins for a catalogue.
The picture shows one skin worn by the Minecraft player model: the front on the left, the back on the right, on a grey background.

Answer with JSON only, in this shape:
{"category": "...", "tags": ["...", "..."], "title": "..."}

category, exactly one of:
- "girls": a girl or a woman
- "boys": a boy or a man
- "characters": a well-known character from a game, film, cartoon or anime, or a human-like figure that is neither clearly a girl nor a boy (a robot, a costume, a mascot)
- "creatures": an animal, a monster, a Minecraft mob or another non-human being

tags: 3 to 8, chosen ONLY from this list, most telling first, at most 2 colours:
${SKIN_TAGS.join(', ')}

title: 2 to 4 plain English words naming what the skin shows, like "Pink haired witch" or "Knight in gold armor": capital letter on the first word only. No names of real people.

Only describe what is visible. If a tag is not clearly true, leave it out.
For an animal, give the animal itself (cat, fox, ...) when it is on the list, as well as "animal".
"monster" is for monsters, not for animals. "nature" is for plants, leaves or flowers on the skin, not for animals.`;

/* Reading a PNG, enough for skins: 8 or 16 bits, grey, RGB, palette, with or without alpha, not interlaced. */

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function readPng(bytes) {
  const buf = Buffer.from(bytes);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let at = 8;
  let width = 0, height = 0, depth = 0, type = 0, interlace = 0;
  let palette = null, alphaTable = null;
  const data = [];
  while (at < buf.length) {
    const length = buf.readUInt32BE(at);
    const name = buf.toString('latin1', at + 4, at + 8);
    const body = buf.subarray(at + 8, at + 8 + length);
    if (name === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8];
      type = body[9];
      interlace = body[12];
    } else if (name === 'PLTE') palette = body;
    else if (name === 'tRNS') alphaTable = body;
    else if (name === 'IDAT') data.push(body);
    else if (name === 'IEND') break;
    at += 12 + length;
  }
  if (interlace) throw new Error('interlaced PNG');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (!channels) throw new Error(`colour type ${type}`);
  const bitsPerPixel = channels * depth;
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const step = Math.max(1, bitsPerPixel >> 3);
  const raw = inflateSync(Buffer.concat(data));
  const rows = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= step ? rows[y * stride + x - step] : 0;
      const b = y > 0 ? rows[(y - 1) * stride + x] : 0;
      const c = x >= step && y > 0 ? rows[(y - 1) * stride + x - step] : 0;
      const v = line[x];
      rows[y * stride + x] = (filter === 0 ? v : filter === 1 ? v + a : filter === 2 ? v + b : filter === 3 ? v + ((a + b) >> 1) : v + paeth(a, b, c)) & 255;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  const sample = (y, index) => {
    if (depth === 8) return rows[y * stride + index];
    if (depth === 16) return rows[y * stride + index * 2];
    const bit = index * depth;
    const value = (rows[y * stride + (bit >> 3)] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
    return type === 3 ? value : Math.round((value * 255) / ((1 << depth) - 1));
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (type === 3) {
        const i = sample(y, x);
        rgba.set([palette[i * 3], palette[i * 3 + 1], palette[i * 3 + 2], alphaTable && i < alphaTable.length ? alphaTable[i] : 255], o);
      } else if (type === 0 || type === 4) {
        const g = sample(y, x * channels);
        rgba.set([g, g, g, type === 4 ? sample(y, x * channels + 1) : 255], o);
      } else {
        rgba.set([sample(y, x * channels), sample(y, x * channels + 1), sample(y, x * channels + 2), type === 6 ? sample(y, x * channels + 3) : 255], o);
      }
    }
  }
  return { width, height, rgba };
}

/* Writing one. */

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(name, body) {
  const out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0);
  out.write(name, 4, 'latin1');
  body.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
}

export function writePng(width, height, rgb) {
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0);
  head.writeUInt32BE(height, 4);
  head[8] = 8;
  head[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(rgb.buffer, rgb.byteOffset + y * width * 3, width * 3).copy(raw, y * (width * 3 + 1) + 1);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/* The skin worn, front and back. */

/**
 * Where each part's front and back faces are, in a 64×64 skin, and where they go in a
 * 16×32 view. `w` is the arm width (4, or 3 for slim). The old 64×32 layout has no left
 * limbs: they are the right ones, mirrored, as the game draws them.
 */
function partsOf(slim, legacy) {
  const w = slim ? 3 : 4;
  const rightArm = { base: [40, 16], outer: [40, 32] };
  const leftArm = legacy ? { ...rightArm, mirror: true } : { base: [32, 48], outer: [48, 48] };
  const rightLeg = { base: [0, 16], outer: [0, 32] };
  const leftLeg = legacy ? { ...rightLeg, mirror: true } : { base: [16, 48], outer: [0, 48] };
  // [part, size w×h×d, place in the front view (x, y), place in the back view]
  return [
    [{ base: [0, 0], outer: [32, 0] }, [8, 8, 8], [4, 0], [4, 0]],
    [{ base: [16, 16], outer: [16, 32] }, [8, 12, 4], [4, 8], [4, 8]],
    [rightArm, [w, 12, 4], [4 - w, 8], [12, 8]],
    [leftArm, [w, 12, 4], [12, 8], [4 - w, 8]],
    [rightLeg, [4, 12, 4], [4, 20], [8, 20]],
    [leftLeg, [4, 12, 4], [8, 20], [4, 20]],
  ];
}

/** The skin drawn front and back, side by side, on grey, at `scale` pixels to a skin pixel. */
export function look(png, slim, scale = 10) {
  const legacy = png.height * 2 === png.width;
  const unit = png.width / 64;
  const pixel = (x, y) => {
    const sx = Math.floor(x * unit);
    const sy = Math.floor(y * unit);
    const o = (sy * png.width + sx) * 4;
    return [png.rgba[o], png.rgba[o + 1], png.rgba[o + 2], png.rgba[o + 3]];
  };
  const viewW = 16, viewH = 32, gap = 4, margin = 2;
  const width = (margin * 2 + viewW * 2 + gap) * scale;
  const height = (margin * 2 + viewH) * scale;
  const out = new Uint8Array(width * height * 3).fill(128);
  const put = (x, y, [r, g, b, a], opaque) => {
    if (!opaque && a < 128) return;
    for (let dy = 0; dy < scale; dy++) {
      for (let dx = 0; dx < scale; dx++) {
        const o = ((y * scale + dy) * width + x * scale + dx) * 3;
        out[o] = r;
        out[o + 1] = g;
        out[o + 2] = b;
      }
    }
  };
  for (const [side, offsetX] of [['front', margin], ['back', margin + viewW + gap]]) {
    for (const [part, [w, h, d], frontAt, backAt] of partsOf(slim, legacy)) {
      const [px, py] = side === 'front' ? frontAt : backAt;
      for (const [layer, [u, v]] of [['base', part.base], ['outer', part.outer]]) {
        // Front face at (u+d, v+d); back face at (u+2d+w, v+d), seen from behind.
        const fx = side === 'front' ? u + d : u + 2 * d + w;
        const fy = v + d;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const tx = part.mirror ? fx + (w - 1 - x) : fx + x;
            // The old layout ends at row 32: below the head it has no outer layer.
            if (legacy && fy + y >= 32) continue;
            put(offsetX + px + x, margin + py + y, pixel(tx, fy + y), layer === 'base');
          }
        }
      }
    }
  }
  return writePng(width, height, out);
}

/* Asking Gemini. */

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** How long one answer may take before it is given up, in milliseconds. */
const ANSWER_MS = 120_000;

/**
 * What Gemini said about a picture, held to the list and the categories.
 *
 * `tries` is how many times a busy Gemini (429, 503) is waited out. The command waits;
 * the bot asks once and moves on, since a skin left untagged is tagged on a later run and
 * a run spent waiting is a run that looked up nobody.
 */
export async function askGemini(picture, { key, model, tries: most = 5 }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const body = {
    contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: 'image/png', data: picture.toString('base64') } }] }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json' },
  };
  for (let tries = 0; tries < most; tries++) {
    const answer = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ANSWER_MS),
    });
    if (answer.status === 429 || answer.status === 503) {
      if (tries + 1 < most) await sleep(20_000 * (tries + 1));
      continue;
    }
    if (!answer.ok) throw new Error(`Gemini answered ${answer.status}: ${(await answer.text()).slice(0, 200)}`);
    const said = await answer.json();
    const text = said.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`not JSON: ${text.slice(0, 120)}`);
    }
    const tags = [...new Set((Array.isArray(parsed.tags) ? parsed.tags : []).map((one) => String(one).toLowerCase().trim()))];
    return {
      category: SKIN_CATEGORIES.includes(parsed.category) ? parsed.category : null,
      tags: tags.filter((one) => SKIN_TAGS.includes(one)).slice(0, 8),
      dropped: tags.filter((one) => !SKIN_TAGS.includes(one)),
      title: typeof parsed.title === 'string' ? parsed.title.replace(/[^\p{L}\p{N} '\-]/gu, '').trim().slice(0, 60) : null,
      usage: said.usageMetadata ?? null,
    };
  }
  throw new Error(`Gemini still busy after ${most} tries`);
}

/* The command. */

const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);

async function main() {
  const site = (option('--site') ?? '').replace(/\/+$/, '');
  const dry = option('--dry');
  const limit = Number(option('--limit') ?? Infinity);
  const key = (process.env.GEMINI_API_KEY ?? '').trim();
  const model = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';
  // Free tier: about fifteen requests a minute for the light model, ten for the full one.
  const pause = model.includes('lite') ? 4500 : 6500;
  if (!site || !key || (!dry && !args.includes('--write'))) {
    console.error('usage: GEMINI_API_KEY=… node tools/skin-tagger.mjs --site URL (--dry DIR | --write) [--limit N]');
    return 2;
  }
  if (dry) mkdirSync(dry, { recursive: true });

  const found = [];
  for (let page = 1; found.length < limit; page++) {
    const said = await (await fetch(`${site}/api/found?page=${page}`)).json();
    found.push(...said.models.filter((one) => args.includes('--write') ? one.tags.length === 0 : true));
    if (page >= said.pages) break;
  }
  const todo = found.slice(0, limit);
  console.log(`${todo.length} skins, model ${model}`);
  const results = [];
  let tokens = 0;
  for (const [at, model_] of todo.entries()) {
    const png = readPng(new Uint8Array(await (await fetch(`${site}/api/skins/${model_.id}.png?for=view`)).arrayBuffer()));
    const picture = look(png, model_.version === 'slim');
    try {
      const said = await askGemini(picture, { key, model });
      tokens += said.usage?.totalTokenCount ?? 0;
      results.push({ id: model_.id, name: model_.name, ...said });
      if (dry) writeFileSync(join(dry, `${String(at + 1).padStart(3, '0')}-${model_.id}.png`), picture);
      console.log(`${at + 1}/${todo.length} ${model_.id} ${said.category} [${said.tags.join(', ')}] "${said.title}"${said.dropped.length ? ` dropped: ${said.dropped.join(', ')}` : ''}`);
      if (!dry) {
        const answer = await fetch(`${site}/api/bot/skins/${model_.id}/look`, {
          method: 'PUT',
          headers: { 'x-bot-key': process.env.SKIN_BOT_KEY ?? '', 'content-type': 'application/json' },
          body: JSON.stringify({ category: said.category, tags: said.tags, name: said.title }),
        });
        if (!answer.ok) console.warn(`  the site answered ${answer.status}: ${await answer.text()}`);
      }
    } catch (why) {
      console.warn(`${at + 1}/${todo.length} ${model_.id}: ${why.message}`);
    }
    await sleep(pause);
  }
  if (dry) writeFileSync(join(dry, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
  console.log(`done: ${results.length} tagged, ${tokens} tokens in all`);
  return 0;
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/').replace(/^\//, '')}` || process.argv[1]?.endsWith('skin-tagger.mjs')) {
  process.exitCode = await main();
}
