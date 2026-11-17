// End-to-end agent exercise. The repository XML is only read, never written.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { root } from '../runner.mjs';
const cli = resolve(root, 'regression/cli.mjs');
const dir = mkdtempSync(join(tmpdir(), 'forsta-agent-change-'));
const originalPath = resolve(root, 'surveys/3522RL.xml');
const original = readFileSync(originalPath);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function run(args, expectedExit = 0) {
  const result = spawnSync(process.execPath, [cli, ...args, '--json', '-'], { cwd: dir, encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, expectedExit, result.stdout + result.stderr);
  return JSON.parse(result.stdout);
}
try {
  const discovered = run(['examples', 'follow-up']);
  assert.ok(discovered.examples.some(e => e.id === 'routing/single-followup'));
  const description = run(['show', 'routing/single-followup']);
  const block = description.sources.blocks.find(b => b.entity === '1652543210' && b.kind === 'Expression');
  const fixtures = run(['fixture', 'routing/single-followup']);
  const xml = join(dir, 'survey.xml'), fixture = join(dir, 'fixture.json');
  writeFileSync(xml, original); writeFileSync(fixture, JSON.stringify(fixtures));
  const args = ['test', xml, '--fixtures', fixture];
  console.log(`Baseline: ${run(args).passed} passed.`);
  const encoded = block.code.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const text = original.toString('utf8');
  assert.equal(text.split(encoded).length, 2, 'source expression must match once');
  assert.ok(encoded.includes('&gt; 1'));
  writeFileSync(xml, text.replace(encoded, encoded.replace('&gt; 1', '&gt; 0')));
  const changed = run(args, 1), failures = changed.results.filter(r => r.status === 'failed');
  assert.ok(failures.some(r => r.failure.code === 'ASSERTION_FAILED'));
  console.log(`Changed threshold: detected ${failures.length} failure(s), including ${failures[0].id}.`);
  writeFileSync(xml, original);
  console.log(`Repaired copy: ${run(args).passed} passed.`);
  assert.equal(hash(readFileSync(originalPath)), hash(original));
  console.log('Original export hash unchanged. Temporary files removed.');
} finally { rmSync(dir, { recursive: true, force: true }); }
