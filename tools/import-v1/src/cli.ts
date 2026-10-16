/**
 * One-way import: TerritoriosMap v1 (jsonb blobs) → 2.0 schema.
 *
 *   npx tsx --tsconfig tools/import-v1/tsconfig.json tools/import-v1/src/cli.ts [--from-file f] [--apply]
 *
 * Dry run is the default. See tools/import-v1/README.md.
 */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { convert } from './convert';
import { readSnapshotFile, readV1 } from './source';
import { apply, plan, type TablePlan } from './sync';
import { territoriesFromKml } from './territories';
import { Report, type Desired } from './types';

const HELP = `Usage: tsx --tsconfig tools/import-v1/tsconfig.json tools/import-v1/src/cli.ts [options]

Source (read-only):
  --from-file <snapshot.json>   offline snapshot {salidas, carrito, programa}
                                (otherwise reads v1 via V1_SUPABASE_URL + V1_SUPABASE_KEY)
  --save-snapshot <path>        also write the v1 rows read to <path> (contains real names!)
  --kml <path>                  territories KML (default apps/web/public/territorios.kml)

Target (TARGET_SUPABASE_URL + TARGET_SERVICE_KEY, env only):
  --dry-run                     default: print counts and the diff, write nothing
  --apply                       write inserts/updates/scoped deletes
  -h, --help`;

const DEFAULT_KML = fileURLToPath(new URL('../../../apps/web/public/territorios.kml', import.meta.url));

function env(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

function origin(url: string, name: string): string {
  try {
    return new URL(url).origin.toLowerCase();
  } catch {
    throw new Error(`${name} is not a valid URL`);
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'from-file': { type: 'string' },
      'save-snapshot': { type: 'string' },
      kml: { type: 'string' },
      'dry-run': { type: 'boolean' },
      apply: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
  });
  if (values.help) {
    console.log(HELP);
    return;
  }
  if (values.apply && values['dry-run']) throw new Error('choose one of --dry-run / --apply');
  const doApply = values.apply === true;

  const v1Url = env('V1_SUPABASE_URL');
  const v1Key = env('V1_SUPABASE_KEY');
  const targetUrl = env('TARGET_SUPABASE_URL');
  const targetKey = env('TARGET_SERVICE_KEY');

  // Safety first: the target must never be the v1 project.
  if (targetUrl && v1Url && origin(targetUrl, 'TARGET_SUPABASE_URL') === origin(v1Url, 'V1_SUPABASE_URL')) {
    throw new Error('TARGET_SUPABASE_URL equals V1_SUPABASE_URL: refusing to run (never write to v1)');
  }
  if (targetKey && v1Key && targetKey === v1Key) throw new Error('TARGET_SERVICE_KEY equals V1_SUPABASE_KEY: refusing to run');
  if (doApply && (!targetUrl || !targetKey)) throw new Error('--apply needs TARGET_SUPABASE_URL and TARGET_SERVICE_KEY');

  // 1. Source
  let snapshot;
  if (values['from-file']) {
    snapshot = await readSnapshotFile(values['from-file']);
    console.log(`source: file ${values['from-file']}`);
  } else {
    if (!v1Url || !v1Key) throw new Error('set V1_SUPABASE_URL + V1_SUPABASE_KEY, or pass --from-file');
    snapshot = await readV1(v1Url, v1Key);
    console.log(`source: v1 REST ${origin(v1Url, 'V1_SUPABASE_URL')} (read-only GET)`);
  }
  if (values['save-snapshot']) {
    await writeFile(values['save-snapshot'], JSON.stringify(snapshot, null, 2));
    console.log(`snapshot saved to ${values['save-snapshot']} (contains real names: keep it out of git)`);
  }

  // 2. Convert
  const report = new Report();
  const territories = await territoriesFromKml(values.kml ?? DEFAULT_KML, report);
  const desired = convert(snapshot, territories, report);
  printDesired(desired);
  printWarnings(report);

  // 3. Diff against the target
  if (!targetUrl || !targetKey) {
    console.log('\nno TARGET_SUPABASE_URL/TARGET_SERVICE_KEY: conversion only, no diff.');
    return;
  }
  const db = createClient(targetUrl, targetKey, { auth: { persistSession: false, autoRefreshToken: false } });
  console.log(`\ntarget: ${origin(targetUrl, 'TARGET_SUPABASE_URL')}`);
  const plans = await plan(db, desired);
  printPlan(plans);

  const pending = plans.reduce((n, p) => n + p.inserts.length + p.updates.length + p.prunes.length, 0);
  if (!doApply) {
    console.log(`\nDRY RUN: ${pending} row change(s) pending. Re-run with --apply to write.`);
    return;
  }
  if (pending === 0) {
    console.log('\nAPPLY: target already matches v1. No-op (nothing written).');
    return;
  }
  await apply(db, plans);
  const after = await plan(db, convert(snapshot, territories, new Report()));
  const left = after.reduce((n, p) => n + p.inserts.length + p.updates.length + p.prunes.length, 0);
  console.log(`\nAPPLY: wrote ${pending} row change(s). Verify re-diff: ${left} pending${left ? ' (UNEXPECTED)' : ' ✓'}.`);
  if (left) process.exitCode = 1;
}

function printDesired(d: Desired): void {
  console.log('\nconverted rows:');
  for (const [table, rows] of Object.entries(d)) console.log(`  ${table.padEnd(20)} ${String(rows.length).padStart(5)}`);
}

function printWarnings(report: Report): void {
  if (!report.warnings.size) {
    console.log('\nwarnings: none');
    return;
  }
  console.log('\nwarnings (skipped/adjusted, nothing dropped silently):');
  for (const [reason, items] of report.warnings) {
    const sample = items.slice(0, 3).join('; ');
    console.log(`  ${String(items.length).padStart(4)} × ${reason}${sample ? `  [${sample}${items.length > 3 ? '; …' : ''}]` : ''}`);
  }
}

function printPlan(plans: TablePlan[]): void {
  const head = ['table', 'desired', 'target', 'insert', 'update', 'same', 'delete', 'kept-extra'];
  const w = [20, 8, 7, 7, 7, 6, 7, 10];
  const line = (cells: (string | number)[]) =>
    console.log('  ' + cells.map((c, i) => (i === 0 ? String(c).padEnd(w[i]!) : String(c).padStart(w[i]!))).join(' '));
  line(head);
  for (const p of plans) line([p.table, p.desired, p.existing, p.inserts.length, p.updates.length, p.unchanged, p.prunes.length, p.targetOnly]);
  const changed = plans.filter((p) => Object.keys(p.changedCols).length);
  if (changed.length) {
    console.log('  changed columns:');
    for (const p of changed) {
      console.log(`    ${p.table}: ${Object.entries(p.changedCols).map(([c, n]) => `${c}×${n}`).join(', ')}`);
    }
  }
}

main().catch((err: unknown) => {
  console.error(`import-v1: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
