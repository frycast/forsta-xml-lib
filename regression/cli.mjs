#!/usr/bin/env node
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { compileStatus, coverage, junit, loadSurvey, loadSurveys, root, runScenario } from './runner.mjs';

function save(path, content) {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(path, content);
}
const json = value => JSON.stringify(value, null, 2) + '\n';

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    json: { type: 'string' }, junit: { type: 'string' }, case: { type: 'string' }, suite: { type: 'string' },
  } });
  const [command, file, ...extra] = positionals;
  if (extra.length || !['test', 'inventory', 'extract'].includes(command)) {
    throw new Error('Usage: node regression/cli.mjs test [--case substring] [--suite directory] [--json file] [--junit file]\n       node regression/cli.mjs inventory [--json file]\n       node regression/cli.mjs extract survey.xml [--json file]');
  }
  if (command !== 'extract' && file) throw new Error(`${command} does not take a positional file`);
  if (command === 'extract') {
    if (!file) throw new Error('extract requires an XML path');
    const output = json(loadSurveys([resolve(file)])[0]);
    if (values.json) save(values.json, output); else process.stdout.write(output);
  } else if (command === 'inventory') {
    const files = readdirSync(resolve(root, 'surveys')).filter(f => f.endsWith('.xml')).sort().map(f => resolve(root, 'surveys', f));
    const surveys = loadSurveys(files);
    const counts = blocks => blocks.reduce((result, block) => {
      const status = compileStatus(block);
      result[status] = (result[status] || 0) + 1;
      return result;
    }, {});
    const report = { surveys: surveys.length, blocks: counts(surveys.flatMap(s => s.blocks)),
      files: surveys.map(s => ({ file: s.file, name: s.name, sha256: s.sha256, language: s.language,
        blocks: counts(s.blocks), kinds: s.blocks.reduce((a, b) => { a[b.kind] = (a[b.kind] || 0) + 1; return a; }, {}),
        unsupported: s.blocks.filter(b => compileStatus(b) === 'unsupported-syntax').map(({ key, entity, name, kind, line }) => ({ key, entity, name, kind, line })),
        unexecutedSurfaces: s.unexecutedSurfaces })) };
    console.log(`${report.surveys} XML exports; ${JSON.stringify(report.blocks)}`);
    console.log('Compilation is not execution or behavioural coverage. Browser code is inventory only.');
    if (values.json) save(values.json, json(report));
  } else {
    const suite = resolve(values.suite || resolve(root, 'regression/scenarios'));
    const scenarios = [];
    for (const name of readdirSync(suite).filter(n => n.endsWith('.mjs')).sort()) {
      const loaded = (await import(pathToFileURL(resolve(suite, name)))).default;
      if (!Array.isArray(loaded)) throw new Error(`${name} must export an array of scenarios`);
      scenarios.push(...loaded);
    }
    if (new Set(scenarios.map(s => s.id)).size !== scenarios.length) throw new Error('Duplicate scenario IDs');
    const selected = scenarios.filter(s => !values.case || s.id.includes(values.case));
    if (!selected.length) throw new Error('No scenarios selected');
    const results = selected.map(s => runScenario(s));
    for (const r of results.filter(r => r.status === 'failed')) {
      console.error(`FAIL ${r.id}\n  ${r.survey}\n  step ${r.failure.step}: ${JSON.stringify(r.failure.source)}\n  ${r.failure.message}`);
      if (r.failure.scriptLocation) console.error(`  ${r.failure.scriptLocation}`);
      console.error(`  trace: ${JSON.stringify(r.actual?.trace || [])}`);
    }
    const surveys = [...new Set(selected.map(s => s.survey))].sort().map(loadSurvey);
    const report = { passed: results.filter(r => r.status === 'passed').length,
      failed: results.filter(r => r.status === 'failed').length, coverage: coverage(surveys, results), results };
    if (values.json) save(values.json, json(report));
    if (values.junit) save(values.junit, junit(results));
    console.log(`${report.passed} passed; ${report.failed} failed; ${surveys.length} surveys`);
    for (const row of report.coverage) {
      const server = Object.entries(row.blocks).filter(([k]) => k.startsWith('server/')).map(([, v]) => v);
      console.log(`  ${row.survey}: ${server.reduce((n, b) => n + b.reachedInPassingCases, 0)}/${server.reduce((n, b) => n + b.total, 0)} server blocks reached; ${row.conditionsWithBothOutcomes} XML conditions exercised both ways`);
    }
    if (report.failed) process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
