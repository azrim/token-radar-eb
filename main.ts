// Token Radar — make.fun token-radar-01 entry (Node 22, standard library only).
//
// Reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>), scores all 198
// standalone pre-token protocols with the Empirical Bayes two-part model (comps-2) in
// dashboard/model.js, verifies every gate invariant, and writes:
//
//   /output/board.json     ranked board (198 rows: rank, slug, name, implied_value_usd, farm_steps)
//   /output/data.js        window.RADAR dataset beside the page
//   /output/dashboard/     dashboard/ copied verbatim
//   /output/screenshots/   screenshots/ copied verbatim
//   /output/dossier.json   canonical dossier from vendor/makefun-board.ts's buildDossier

import { createRequire } from 'node:module';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';

interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  implied_value_usd: number;
  farm_steps: string[];
  [key: string]: unknown;
}

interface RadarData {
  counts: {
    protocols: number;
    ranked: number;
    watchlist: number;
    offlist: number;
    early: number;
    live: number;
    token_subpools: number;
    excluded: number;
    farm: number;
    marginal: number;
    skip: number;
  };
  [key: string]: unknown;
}

interface RadarModelApi {
  buildRadar(snapshot: unknown, params?: unknown): { board: BoardRow[]; data: RadarData };
  boardIssue(board: BoardRow[], snapshot: unknown): string | null;
  PARAMS: Record<string, number>;
}

const req = createRequire(import.meta.url);
const RadarModel = req('./dashboard/model.js') as RadarModelApi;

const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const here = fileURLToPath(new URL('.', import.meta.url));
const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = JSON.parse(readFileSync(inputFile, 'utf8')) as Record<string, unknown>;
if (typeof snapshot.as_of !== 'string' || !Array.isArray(snapshot.protocols) || !Array.isArray(snapshot.watchlist)) {
  process.stderr.write('token radar: snapshot lacks as_of, protocols or watchlist\n');
  process.exit(2);
}

const { board, data } = RadarModel.buildRadar(snapshot);
const issue = RadarModel.boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: gate check failed: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), `window.RADAR=${JSON.stringify(data)};\n`);

function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const p = join(from, name);
    if (!statSync(p).isFile()) continue;
    copyFileSync(p, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dash = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} images; need 3..4\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: invalid screenshot filename ${name}\n`);
    process.exit(1);
  }
}

const dossierBuf = Buffer.from(
  buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS }),
);
writeFileSync(join(out, 'dossier.json'), dossierBuf);

const dossierObj = JSON.parse(dossierBuf.toString('utf8')) as { text: string };
const textBytes = Buffer.byteLength(dossierObj.text, 'utf8');
if (dossierObj.text.includes('[Cut at ')) {
  process.stderr.write(`token radar: dossier.text was truncated at ${textBytes}B\n`);
  process.exit(1);
}

const dossierBytes = statSync(join(out, 'dossier.json')).size;
const dataBytes = statSync(join(out, 'data.js')).size;
const boardBytes = statSync(join(out, 'board.json')).size;
const c = data.counts;
process.stdout.write(
  `token radar: ${c.protocols} protocols -> ${c.ranked} ranked (${c.watchlist} watchlist, ${c.offlist} off-list >=$50M, ${c.early} below floor), ${c.live} live comps, ${c.token_subpools} token sub-pools, ${c.excluded} excluded\n` +
  `token radar: verdicts ${c.farm} farm / ${c.marginal} marginal / ${c.skip} skip · board.json ${boardBytes}B, data.js ${dataBytes}B, dashboard/ ${dash.length} files, text ${textBytes}B, screenshots/ ${shots.length} images, dossier.json ${dossierBytes}B\n`,
);
