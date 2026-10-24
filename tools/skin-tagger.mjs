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
// Safety, in the same request: whether the skin shows what the site must not show to anybody
// who opens a launcher (`SAFETY`). Nobody published a found skin, so nobody has looked at it;
// this is the only look it gets before it is listed, and a skin it refuses is taken down.
// A second picture goes with the first: the front of the torso and hips, large (`closeup`).
// Nudity on a skin is a pixel or two of pink or a darker shade; in the whole-body picture
// alone the model called three naked skins out of four "ok". With the close-up and a rule
// that says what to look for, asked about safety alone, it caught all four and let eleven
// of twelve skins in swimwear pass; asked for tags in the same request, two of the four,
// which is why the answer now describes the torso (`body`) before it decides
// (docs/skin-bot-plan.md).
//
// Photos, before all that and apart from it (`askPhoto`): Cloudflare's clef-flash answers
// one yes-or-no question for about two of Workers AI's "neurons", so every new skin can be
// asked the moment it is found, long before its turn with Gemini comes. It is asked about
// photos only: on nudity it could not tell a naked body from swimwear, and Gemini can.
//
// Usage:
//   node tools/skin-tagger.mjs --site URL --dry DIR [--limit N]
//       tag the found skins of a site without writing anything: the pictures and the
//       answers go to DIR, for a person to look through before anything is trusted
//   node tools/skin-tagger.mjs --site URL --write [--limit N]
//       tag and check the found skins the site has not had judged, and write them through the bot's route
//
// Read from the environment:
//   GEMINI_API_KEY    the key for Google's Gemini API. Required.
//   GEMINI_MODELS     the models to ask, a comma list in order of preference, default `LOOKERS`;
//                     GEMINI_MODEL, one model, is still read when GEMINI_MODELS is not set
//   SKIN_BOT_KEY      the site's bot key, for --write
//
// Gemini's free tier allows about fifteen requests a minute to a light model and a number a
// day to each model of its own, so requests go out one at a time with a pause between them,
// and when a model's day is spent the next one in the list is asked (`askAny`).

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

/**
 * What a skin may be judged: fine, or the reason it must not be listed. The site takes down
 * a found skin with any answer but "ok" (worker/players.ts, `dressFound`).
 */
export const SAFETY = ['ok', 'photo', 'sexual', 'gore', 'hate'];

const PROMPT = `You tag Minecraft player skins for a catalogue.
The picture shows one skin worn by the Minecraft player model: the front on the left, the back on the right, on a grey background.
The second picture is a close-up of the front of the same skin: the torso, the arms and the top of the legs.

Answer with JSON only, in this shape:
{"category": "...", "tags": ["...", "..."], "title": "...", "body": "...", "safety": "..."}

body: one short sentence on what is drawn on the torso and the hips in the second picture, written before safety is decided.

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
"monster" is for monsters, not for animals. "nature" is for plants, leaves or flowers on the skin, not for animals.

safety, exactly one of, for a catalogue children use:
- "photo": a photograph or a photo-like picture of a real person anywhere on the skin, such as a face pasted onto the body or the head, even when pixelated, small or in grey. A face drawn in pixel art, however detailed or shaded, is not a photo.
- "sexual": a body drawn naked, in skin colour or in any other colour (blue, green, orange, pale): the hips not covered by any clothing, or a woman's breasts not covered; genitals, or nipples on a woman's breasts, drawn even as a single pixel or two of pink, red or a darker shade; white or coloured fluid on the face or body, or anything else suggesting a sexual act. Skins are tiny pixel art, so these details are only a pixel or two: look closely at the second picture. A man's bare chest, even with nipples, is not sexual when his hips are covered by swimwear, underwear, shorts or trousers; nor is a woman in a bikini or a swimsuit.
- "gore": blood, wounds, organs or severed body parts shown in detail
- "hate": hate symbols (such as a swastika), slurs or insults written on the skin
- "ok": none of these`;

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

/**
 * The front of the torso, the arms and the top of the legs from `look`'s picture, at
 * `scale` pixels to a skin pixel: the second picture Gemini gets, where a pixel of detail is
 * a square big enough to see. In `look`'s units the front view's body runs from y 10 to 22
 * and its arms from x 2 to 18; this takes x 0 to 20 and y 9 to 28.
 */
export function closeup(png, slim, scale = 24) {
  const whole = readPng(look(png, slim, scale));
  const left = 0, top = 9 * scale, width = 20 * scale, height = 19 * scale;
  const out = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = ((top + y) * whole.width + left + x) * 4;
      const d = (y * width + x) * 3;
      out[d] = whole.rgba[s];
      out[d + 1] = whole.rgba[s + 1];
      out[d + 2] = whole.rgba[s + 2];
    }
  }
  return writePng(width, height, out);
}

/* Asking Workers AI about photos. */

/**
 * From this probability up, clef-flash's "is there a photo of a real person" is taken as a
 * yes and the skin comes down at once. Measured on 2 000 found skins: the five at 0.23 and
 * above were all photos (looked at one by one), the next was 0.16 and drawn; SEK_Nico's
 * grey pasted face was 0.60. Below it nothing is decided: Gemini still looks.
 */
export const PHOTO_AT = 0.2;

/** Workers AI's neurons spent in a day before photos stop being asked; 10 000 a day are free. */
export const PHOTO_NEURONS_A_DAY = 8000;

/**
 * Neurons one question costs, counted on the safe side: 2.2 measured (2 014 questions,
 * 4 429 neurons on Cloudflare's own count), and the count here is what stops the spending,
 * so it rounds up.
 */
const NEURONS_A_PHOTO = 3;

const PHOTO_QUESTION =
  'Is there a photograph or photo-like picture of a real person anywhere on the skin, such as a face pasted onto the body or the head, even when pixelated, small or in grey? A face drawn in pixel art, however detailed or shaded, is not a photo.';

/**
 * What a day of photo questions may still spend, for one run.
 *
 * Cloudflare has no cap on what Workers AI costs past the free 10 000 neurons a day on the
 * paid plan: it bills. So the stop is here. At the start of a run Cloudflare is asked what
 * today (UTC, when its free day turns) has spent so far; after that every question is
 * counted here, because Cloudflare's own count runs minutes behind: during 2 000 questions in
 * a row it stayed at the number it had before them. Runs are half an hour apart, one at a
 * time (the workflow's `concurrency`), so the count at the start of the next run has caught
 * up. When Cloudflare cannot be asked, nothing is spent.
 */
export async function photoBudget({ account, token, ceiling = PHOTO_NEURONS_A_DAY }) {
  const day = new Date().toISOString().slice(0, 10);
  const query = `{ viewer { accounts(filter: {accountTag: "${account}"}) { aiInferenceAdaptiveGroups(limit: 100, filter: {date: "${day}"}) { sum { totalNeurons } } } } }`;
  let spent = Infinity;
  try {
    const answer = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(30_000),
    });
    const said = await answer.json();
    const groups = said.data?.viewer?.accounts?.[0]?.aiInferenceAdaptiveGroups;
    if (answer.ok && Array.isArray(groups)) spent = groups.reduce((sum, one) => sum + (one.sum?.totalNeurons ?? 0), 0);
  } catch {
    // Left at Infinity: an unknown spend allows nothing.
  }
  return {
    spentBefore: spent,
    asked: 0,
    allows() {
      return spent + (this.asked + 1) * NEURONS_A_PHOTO <= ceiling;
    },
  };
}

/**
 * The probability clef-flash gives that the picture (`look`'s) has a photo of a real person
 * on it, or null when it did not answer. Counted against `budget` whether it answered or not.
 */
export async function askPhoto(picture, { account, token, budget }) {
  budget.asked++;
  try {
    const answer = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/@cf/cloudflare/clef-flash`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'clef-flash',
        state: 'The picture shows one Minecraft player skin worn by the player model: the front on the left, the back on the right, on a grey background.',
        images: [`data:image/png;base64,${picture.toString('base64')}`],
        questions: { photo: { type: 'noul', instructions: PHOTO_QUESTION } },
      }),
      signal: AbortSignal.timeout(60_000),
    });
    const said = await answer.json();
    const yes = said.result?.answers?.photo?.noul;
    return typeof yes === 'number' ? yes : null;
  } catch {
    return null;
  }
}

/* Asking Gemini. */

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** How long one answer may take before it is given up, in milliseconds. */
const ANSWER_MS = 120_000;

/**
 * A model that cannot answer now: over its pace or busy (`forTheDay` false: ask it again in
 * a minute), or done with its free allowance for the day (`forTheDay`: not again this run).
 */
export class Busy extends Error {
  constructor(message, forTheDay) {
    super(message);
    this.forTheDay = forTheDay;
  }
}

/**
 * What Gemini said about a picture, held to the list and the categories.
 *
 * `tries` is how many times a busy Gemini (429, 500, 503) is waited out before `Busy` is
 * thrown; a 429 that names the daily allowance is not waited out at all. The bot asks once
 * and moves on to the next model (`askAny`): a run spent waiting is a run that checked nothing.
 * `close` is `closeup`'s picture of the same skin; without it the prompt's second picture is
 * missing and nudity goes unseen far more often.
 */
export async function askGemini(picture, { key, model, tries: most = 5, close = null }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const parts = [{ text: PROMPT }, { inline_data: { mime_type: 'image/png', data: picture.toString('base64') } }];
  if (close) parts.push({ inline_data: { mime_type: 'image/png', data: close.toString('base64') } });
  const body = {
    contents: [{ parts }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json' },
  };
  for (let tries = 0; ; tries++) {
    let answer;
    try {
      answer = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(ANSWER_MS),
      });
    } catch (why) {
      // Slow beyond `ANSWER_MS`, or the line dropped: the model, not the skin.
      if (tries + 1 >= most) throw new Busy(`${model}: ${why.message}`, false);
      continue;
    }
    if (answer.status === 429 || answer.status === 500 || answer.status === 503) {
      const said = await answer.text();
      // Gemini names the allowance it ran out of: "…PerDay…" is spent until midnight Pacific.
      const forTheDay = answer.status === 429 && /PerDay/i.test(said);
      if (forTheDay || tries + 1 >= most) throw new Busy(`${model} answered ${answer.status}`, forTheDay);
      await sleep(20_000 * (tries + 1));
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
      // Anything but one of the answers is no answer: the skin stays unchecked and is asked again.
      safety: SAFETY.includes(parsed.safety) ? parsed.safety : null,
      usage: said.usageMetadata ?? null,
    };
  }
}

/* Asking more than one model. */

/**
 * The models asked by default, in order. Each has its own free allowance for the day (500
 * requests for gemini-3.5-flash-lite on 2026-10-24, which `gemini-flash-lite-latest` was
 * then), so every model here is another day's worth of checks: when one answers that its day
 * is spent, the rest go on. The light ones first, being quicker.
 *
 * Only models that called SEK_Nico's skin a photo are here (docs/skin-bot-plan.md, "Как
 * проверять больше тысячи в сутки"): asked in a batch, or asked of the free models on
 * OpenRouter, the same picture came back "ok".
 */
export const LOOKERS = [
  'gemini-flash-lite-latest',
  'gemini-3.1-flash-lite',
  'gemini-3.1-flash-lite-preview',
  'gemini-3-flash-preview',
  'gemini-3.5-flash',
  'gemini-3.6-flash',
];

/** The least time between two questions to one model, in milliseconds: the free tier's pace. */
const LOOKER_GAP = { lite: 4500, other: 6500 };
/** How long a model that answered busy is left alone, in milliseconds. */
const LOOKER_REST = 60_000;

/**
 * The models to ask, from the environment: `GEMINI_MODELS` (a comma list), else
 * `GEMINI_MODEL` alone, else `LOOKERS`. Each with when it may next be asked.
 */
export function lookersOf(env, key = (env.GEMINI_API_KEY ?? '').trim()) {
  const names = (env.GEMINI_MODELS || env.GEMINI_MODEL || LOOKERS.join(','))
    .split(',')
    .map((one) => one.trim())
    .filter(Boolean);
  return names.map((model) => ({
    model,
    key,
    gap: model.includes('lite') ? LOOKER_GAP.lite : LOOKER_GAP.other,
    next: 0,
    spent: false,
    answered: 0,
  }));
}

/**
 * A picture asked of the first model free to answer it: `{ answer, by }`, or null when every
 * model's day is spent or `until` comes first.
 *
 * In the list's order, so the first model answers whenever its pace allows and the next only
 * while it may not; a model that answers busy rests a minute, one whose day is spent is not
 * asked again. When every model is resting, this waits for the first to be free. `close` is
 * passed on to `askGemini`.
 */
export async function askAny(lookers, picture, { until = Infinity, close = null } = {}) {
  for (;;) {
    const open = lookers.filter((one) => !one.spent);
    if (!open.length) return null;
    const now = Date.now();
    const free = open.find((one) => one.next <= now);
    if (!free) {
      const soonest = Math.min(...open.map((one) => one.next));
      if (soonest >= until) return null;
      await sleep(soonest - now);
      continue;
    }
    if (now >= until) return null;
    free.next = now + free.gap;
    try {
      const answer = await askGemini(picture, { key: free.key, model: free.model, tries: 1, close });
      free.answered++;
      return { answer, by: free.model };
    } catch (why) {
      if (!(why instanceof Busy)) throw why;
      if (why.forTheDay) free.spent = true;
      else free.next = Date.now() + LOOKER_REST;
    }
  }
}

/* The command. */

const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);

async function main() {
  const site = (option('--site') ?? '').replace(/\/+$/, '');
  const dry = option('--dry');
  const limit = Number(option('--limit') ?? Infinity);
  const key = (process.env.GEMINI_API_KEY ?? '').trim();
  const lookers = lookersOf(process.env, key);
  if (!site || !key || (!dry && !args.includes('--write'))) {
    console.error('usage: GEMINI_API_KEY=… node tools/skin-tagger.mjs --site URL (--dry DIR | --write) [--limit N]');
    return 2;
  }
  if (dry) mkdirSync(dry, { recursive: true });

  const found = [];
  if (args.includes('--write')) {
    // What the site has not had judged yet, the never tagged and the tagged before the safety question.
    const said = await (
      await fetch(`${site}/api/bot/unchecked?limit=${Number.isFinite(limit) ? limit : 200}`, { headers: { 'x-bot-key': process.env.SKIN_BOT_KEY ?? '' } })
    ).json();
    found.push(...said.skins.map((one) => ({ ...one, name: '' })));
  } else {
    for (let page = 1; found.length < limit; page++) {
      const said = await (await fetch(`${site}/api/found?page=${page}`)).json();
      found.push(...said.models);
      if (page >= said.pages) break;
    }
  }
  const todo = found.slice(0, limit);
  console.log(`${todo.length} skins, models ${lookers.map((one) => one.model).join(', ')}`);
  const results = [];
  let tokens = 0;
  for (const [at, model_] of todo.entries()) {
    const png = readPng(new Uint8Array(await (await fetch(`${site}/api/skins/${model_.id}.png?for=view`)).arrayBuffer()));
    const picture = look(png, model_.version === 'slim');
    try {
      const asked = await askAny(lookers, picture, { close: closeup(png, model_.version === 'slim') });
      if (!asked) {
        console.log('every model has spent its day; the rest wait for tomorrow');
        break;
      }
      const said = asked.answer;
      tokens += said.usage?.totalTokenCount ?? 0;
      results.push({ id: model_.id, name: model_.name, ...said });
      if (dry) writeFileSync(join(dry, `${String(at + 1).padStart(3, '0')}-${model_.id}.png`), picture);
      console.log(`${at + 1}/${todo.length} ${model_.id} ${said.category} [${said.tags.join(', ')}] "${said.title}" ${said.safety ?? 'unchecked'} (${asked.by})${said.dropped.length ? ` dropped: ${said.dropped.join(', ')}` : ''}`);
      if (!dry) {
        const answer = await fetch(`${site}/api/bot/skins/${model_.id}/look`, {
          method: 'PUT',
          headers: { 'x-bot-key': process.env.SKIN_BOT_KEY ?? '', 'content-type': 'application/json' },
          body: JSON.stringify({ category: said.category, tags: said.tags, name: said.title, safety: said.safety }),
        });
        if (!answer.ok) console.warn(`  the site answered ${answer.status}: ${await answer.text()}`);
      }
    } catch (why) {
      console.warn(`${at + 1}/${todo.length} ${model_.id}: ${why.message}`);
    }
  }
  if (dry) writeFileSync(join(dry, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
  console.log(`done: ${results.length} tagged, ${tokens} tokens in all`);
  return 0;
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/').replace(/^\//, '')}` || process.argv[1]?.endsWith('skin-tagger.mjs')) {
  process.exitCode = await main();
}
