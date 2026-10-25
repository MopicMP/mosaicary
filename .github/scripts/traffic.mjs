// Keeps GitHub's traffic numbers for this repository, which GitHub itself forgets after
// fourteen days: without them there is no telling whether anything done about how people
// find the project made a difference.
//
// Writes three files under stats/:
//   traffic-views.csv      date,views,unique_views,clones,unique_clones — one row a day
//   traffic-referrers.csv  snapshot,referrer,views,unique_views — GitHub's top ten sites
//   traffic-paths.csv      snapshot,path,views,unique_views     and pages, over the last
//                          fourteen days as of the snapshot date (GitHub gives no daily split)
//
// Every day GitHub still holds is written again, so a missed run loses nothing as long as
// the next one comes within the fortnight; today is left out until it is over. A snapshot
// is one per date: a second run on the same day replaces it.
//
// node .github/scripts/traffic.mjs   (TRAFFIC_TOKEN: a token that may read the repository's
// traffic, which takes "Administration: read"; GITHUB_REPOSITORY: owner/name)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const token = (process.env.TRAFFIC_TOKEN || '').trim();
const repo = process.env.GITHUB_REPOSITORY || 'MopicMP/mosaicary';
if (!token) {
  console.log('TRAFFIC_TOKEN is not set: traffic not recorded');
  process.exit(0);
}

async function get(path) {
  const answer = await fetch(`https://api.github.com/repos/${repo}/traffic/${path}`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'mosaicary-stats' },
  });
  if (!answer.ok) throw new Error(`traffic/${path}: ${answer.status} ${await answer.text()}`);
  return answer.json();
}

/** A CSV's rows by key, with its header; an absent file is an empty one. */
function readRows(file, header) {
  if (!existsSync(file)) return { header, rows: [] };
  const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
  return { header: lines[0] || header, rows: lines.slice(1) };
}

/** A cell as CSV writes it: quoted when it holds a comma or a quote. */
const cell = (value) => (/[",]/.test(String(value)) ? `"${String(value).replace(/"/g, '""')}"` : String(value));

const today = new Date().toISOString().slice(0, 10);
const [views, clones, referrers, paths] = await Promise.all([get('views'), get('clones'), get('popular/referrers'), get('popular/paths')]);
mkdirSync('stats', { recursive: true });

// Days: every one GitHub still holds, except today, merged over what is kept.
{
  const file = 'stats/traffic-views.csv';
  const { header, rows } = readRows(file, 'date,views,unique_views,clones,unique_clones');
  const byDate = new Map(rows.map((row) => [row.split(',')[0], row]));
  const cloned = new Map(clones.clones.map((one) => [one.timestamp.slice(0, 10), one]));
  for (const one of views.views) {
    const date = one.timestamp.slice(0, 10);
    if (date >= today) continue;
    const c = cloned.get(date);
    byDate.set(date, [date, one.count, one.uniques, c ? c.count : 0, c ? c.uniques : 0].join(','));
  }
  const sorted = [...byDate.keys()].sort().map((date) => byDate.get(date));
  writeFileSync(file, `${[header, ...sorted].join('\n')}\n`);
  console.log(`views: ${sorted.length} days kept`);
}

// The fortnight's top sites and pages, as of today, replacing today's if it was taken already.
for (const [name, list, field] of [
  ['referrers', referrers, 'referrer'],
  ['paths', paths, 'path'],
]) {
  const file = `stats/traffic-${name}.csv`;
  const { header, rows } = readRows(file, `snapshot,${field},views,unique_views`);
  const kept = rows.filter((row) => !row.startsWith(`${today},`));
  for (const one of list) kept.push([today, cell(one[field]), one.count, one.uniques].join(','));
  writeFileSync(file, `${[header, ...kept].join('\n')}\n`);
  console.log(`${name}: ${list.length} as of ${today}`);
}
