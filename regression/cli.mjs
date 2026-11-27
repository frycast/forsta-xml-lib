#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { compileStatus, coverage, junit, loadSurvey, loadSurveys, root, runScenario } from './runner.mjs';
import { allCases, catalogue, example, exampleCases, selectedSources, checkProvenance, provenance, corpusPath, inspectSurvey, loadCases, readFixtures } from './corpus.mjs';

const help = `Offline Forsta development and regression CLI (Node 24, Python 3.10+)
  examples [search words] [--tag tag] [--type type] [--api api]
  show <example-id>                       Code, structures, fixtures and limits
  fixture <example-id> --json file        Export a JSON fixture for local edits
  inspect <survey.xml> [--entity id | --name name | --key XML-path]
  test [--case substring] [--example id] [--suite directory]
  test <survey.xml> --fixtures file.json [--case substring]
  corpus check                           Verify pinned sources (exit 4 if stale)
  corpus lock --revision <40-char-sha>     Pin sources AFTER reviewing changes
  inventory                              Study all exports and duplicate hashes
  extract <survey.xml>                    Original extraction interface
All commands: --json - (JSON only on stdout) or --json file
Test reports: --junit file. Exit 0=success, 1=test failure/empty selection,
2=invalid input/tool error, 4=stale corpus. No production access is used.
See regression/docs/agent-workflow.md. Survey inputs accept a local path or a shell-family path from the survey list.`;
const json = value => JSON.stringify(value, null, 2) + '\n';
function surveyPath(file) {
  const local = resolve(file);
  if (existsSync(local) || !/^(?:lina_shell|src_shell)\//.test(file)) return local;
  const libraryFile = resolve(root, 'surveys', file);
  return existsSync(libraryFile) ? libraryFile : local;
}
function reportSummary(report) {
  return `${values.json}: ${report.nodes.length} structures, ${report.blocks.length} blocks`;
}
function save(path, content) {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(path, content);
}
let values = {}, command;
function output(report, readable) {
  if (values.json === '-') process.stdout.write(json(report));
  else {
    if (values.json) save(values.json, json(report));
    if (readable) console.log(readable);
  }
}
function fail(message, code = 'INVALID_INPUT', exitCode = 2) {
  const error = new Error(message); error.cliCode = code; error.exitCode = exitCode; throw error;
}
const counts = items => items.reduce((o, x) => { o[x] = (o[x] || 0) + 1; return o; }, {});
function formatSources(sources) {
  return [...sources.nodes.map(n => `STRUCTURE ${n.entity} ${n.tag} ${n.name}\n  ${n.key}\n${json(n.structure)}`),
    ...sources.blocks.map(b => `BLOCK ${b.entity} ${b.kind} (${b.environment}) line ${b.line}\n  ${b.key}\n${b.code}`),
    ...sources.surfaces.map(s => `PIPING (not evaluated) ${s.key}\n${s.text}`)].join('\n\n');
}
try {
  const parsed = parseArgs({ allowPositionals: true, options: {
    json: { type: 'string' }, junit: { type: 'string' }, case: { type: 'string' }, suite: { type: 'string' },
    fixtures: { type: 'string' }, example: { type: 'string' }, tag: { type: 'string' }, type: { type: 'string' }, api: { type: 'string' },
    entity: { type: 'string' }, name: { type: 'string' }, key: { type: 'string' }, revision: { type: 'string' }, help: { type: 'boolean' },
  } });
  values = parsed.values;
  const [cmd, file, ...extra] = parsed.positionals; command = cmd;
  if (values.help || !command) { console.log(help); process.exit(0); }
  const allowed = { examples: ['tag','type','api'], show: [], fixture: [], inspect: ['entity','name','key'],
    test: ['case','suite','fixtures','example','junit'], corpus: ['revision'], inventory: [], extract: [] };
  if (!Object.hasOwn(allowed, command)) fail(help);
  for (const key of Object.keys(values)) if (!['json', ...allowed[command]].includes(key)) fail(`--${key} is not valid for ${command}`);
  if (extra.length && command !== 'examples') fail(`Too many arguments for ${command}`);
  if (['show','fixture','inspect','extract','corpus'].includes(command) && !file) fail(`${command} needs an argument`);
  if (command === 'inventory' && file) fail('inventory takes no file');
  if (command === 'examples') {
    const words = [file, ...extra].filter(Boolean).join(' ').toLowerCase().split(/\s+/).filter(Boolean);
    const entries = catalogue().examples.filter(e => words.every(w => JSON.stringify(e).toLowerCase().includes(w)) &&
      [['tag','tags'],['type','questionTypes'],['api','apis']].every(([flag, key]) => !values[flag] || e[key].some(v => v.toLowerCase().includes(values[flag].toLowerCase()))));
    output({ schemaVersion: 1, command, version: catalogue().version, examples: entries },
      entries.map(e => `${e.id}  ${e.title}\n  ${e.status}; ${e.questionTypes.join(', ')}; ${e.tags.join(', ')}`).join('\n') || 'No examples matched.');
  } else if (command === 'show' || command === 'fixture') {
    const entry = example(file), cases = await allCases(), scenarios = exampleCases(entry, cases);
    if (command === 'fixture') output({ schemaVersion: 1, scenarios }, values.json ? `${scenarios.length} fixtures exported.` : json({ schemaVersion: 1, scenarios }));
    else {
      const sources = selectedSources(entry, cases), freshness = checkProvenance(cases);
      const ownStale = freshness.stale.filter(e => e.id === entry.id || e.id === 'catalogue');
      output({ schemaVersion: 1, command, example: entry, provenance: { revision: freshness.revision, surveyHash: loadSurvey(entry.survey).sha256, stale: ownStale }, sources, scenarios },
        `${entry.id}: ${entry.title}\n${entry.use}\nSource: ${entry.survey}; revision ${freshness.revision}; ${ownStale.length ? 'STALE' : 'current'}\nRequirements:\n- ${entry.requirements.join('\n- ')}\nLimitations:\n- ${entry.limitations.join('\n- ')}\nObservations:\n- ${entry.observations.join('\n- ') || 'None recorded.'}\n\n${formatSources(sources)}\n\nFIXTURES\n${json(scenarios)}`);
    }
  } else if (command === 'corpus') {
    const cases = await allCases();
    if (file === 'check') {
      if (values.revision) fail('check does not accept --revision');
      const report = checkProvenance(cases);
      output({ schemaVersion: 1, command: 'corpus check', ...report }, `Corpus ${report.status}; ${report.stale.length} stale entries\n${report.stale.map(e => `${e.id}: ${e.reason}`).join('\n')}`.trim());
      if (report.stale.length) process.exitCode = 4;
    } else if (file === 'lock') {
      if (!/^[0-9a-f]{40}$/.test(values.revision || '')) fail('lock requires --revision with the reviewed source commit SHA');
      const report = provenance(cases, values.revision);
      save(resolve(corpusPath, 'sources.lock.json'), json(report));
      output({ schemaVersion: 1, command: 'corpus lock', examples: report.examples.length, revision: report.revision }, `Pinned ${report.examples.length} examples to ${report.revision}.`);
    } else fail('Use corpus check or corpus lock');
  } else if (command === 'inspect' || command === 'extract') {
    const survey = loadSurveys([surveyPath(file)])[0];
    if (command === 'extract') output(survey, values.json ? reportSummary(survey) : json(survey));
    else {
      const selectors = ['entity','name','key'].filter(k => values[k]);
      if (selectors.length > 1) fail('Use one of --entity, --name or --key');
      const report = inspectSurvey(survey, selectors.length ? { [selectors[0]]: values[selectors[0]] } : null);
      output({ ...report, command }, values.json ? reportSummary(report) : `${report.file}: ${report.nodes.length} structures, ${report.blocks.length} blocks\n${report.limitations.join('\n')}\nUnsupported: ${json(report.unsupported)}\n` + (selectors.length ? formatSources(report) : report.nodes.map(n => `${n.entity} ${n.tag} ${n.name}`).join('\n')));
    }
  } else if (command === 'inventory') {
    const files = readdirSync(resolve(root, 'surveys'), { recursive: true }).filter(f => f.endsWith('.xml')).sort();
    // Process one export at a time; rich structures need not fit in one IPC buffer.
    const surveys = files.map(f => loadSurvey(`surveys/${f}`));
    const duplicate = new Map();
    for (const s of surveys) for (const b of s.blocks.filter(b => b.environment === 'server')) {
      const row = duplicate.get(b.sha256) || { sha256: b.sha256, count: 0, source: { survey: s.file, entity: b.entity, kind: b.kind, key: b.key } };
      row.count++; duplicate.set(b.sha256, row);
    }
    const report = { schemaVersion: 1, command, surveys: surveys.length,
      blocks: counts(surveys.flatMap(s => s.blocks.map(compileStatus))), nodeTypes: counts(surveys.flatMap(s => s.nodes.map(n => n.tag))),
      distinctServerHashes: duplicate.size, mostRepeated: [...duplicate.values()].sort((a,b) => b.count-a.count || a.sha256.localeCompare(b.sha256)).slice(0,20),
      files: surveys.map(s => ({ file: s.file, name: s.name, sha256: s.sha256, language: s.language, blocks: counts(s.blocks.map(compileStatus)),
        kinds: counts(s.blocks.map(b => b.kind)), nodes: counts(s.nodes.map(n => n.tag)),
        unsupported: s.blocks.filter(b => compileStatus(b) === 'unsupported-syntax').map(({ key, entity, name, kind, line }) => ({ key, entity, name, kind, line })), unexecutedSurfaces: s.unexecutedSurfaces })) };
    output(report, `${report.surveys} exports; ${json(report.blocks).trim()}; ${duplicate.size} distinct server hashes\nCompilation is not behavioural coverage. Browser code and piping are not executed.`);
  } else {
    if (file && !values.fixtures) fail('Testing a local XML requires --fixtures file.json');
    if (values.fixtures && !file) fail('--fixtures requires an explicit XML file');
    if ((file || values.fixtures) && (values.example || values.suite)) fail('Local XML fixtures cannot be combined with --example or --suite');
    if (values.example && values.suite) fail('--example cannot be combined with --suite');
    const localSurvey = file && surveyPath(file);
    let scenarios = file ? readFixtures(resolve(values.fixtures)).map(s => ({ ...s, survey: localSurvey }))
      : values.suite ? await loadCases(resolve(values.suite)) : await allCases();
    if (new Set(scenarios.map(s => s.id)).size !== scenarios.length) fail('Duplicate scenario IDs');
    if (values.example) scenarios = exampleCases(example(values.example), scenarios);
    scenarios = scenarios.filter(s => !values.case || s.id.includes(values.case));
    if (!scenarios.length) fail('No scenarios selected', 'EMPTY_SELECTION', 1);
    const freshness = !file && !values.suite ? checkProvenance(await allCases()) : null;
    if (freshness?.stale.length) {
      output({ schemaVersion: 1, command, ...freshness, results: [] }, 'Corpus is stale. Run corpus check; review changes before relocking.');
      process.exitCode = 4;
    } else {
      const results = scenarios.map(s => runScenario(s));
      const surveys = [...new Set(scenarios.map(s => s.survey))].sort().map(loadSurvey);
      const report = { schemaVersion: 1, command, passed: results.filter(r => r.status === 'passed').length,
        failed: results.filter(r => r.status === 'failed').length, coverage: coverage(surveys, results), results };
      for (const r of results.filter(r => r.status === 'failed')) if (values.json !== '-') {
        console.error(`FAIL ${r.id}\n  ${r.survey}\n  step ${r.failure.step} ${r.failure.code || 'WORKER_ERROR'}: ${json(r.failure.source).trim()}\n  ${r.failure.message}\n  trace: ${json(r.actual?.trace || []).trim()}`);
      }
      if (values.junit) save(values.junit, junit(results));
      output(report, `${report.passed} passed; ${report.failed} failed; ${surveys.length} surveys\nSelected cases are evidence under fixture assumptions, not full interview validation.`);
      if (report.failed) process.exitCode = 1;
    }
  }
} catch (error) {
  // parseArgs can fail before assigning values; still honour JSON diagnostics.
  const flag = process.argv.indexOf('--json');
  if (!values.json && flag >= 0) values.json = process.argv[flag + 1];
  if (!values.json) values.json = process.argv.find(a => a.startsWith('--json='))?.slice(7);
  try {
    output({ schemaVersion: 1, command: command || null, error: { code: error.cliCode || 'INVALID_INPUT', message: error.message } });
  } catch (writeError) { console.error(`Cannot write JSON report: ${writeError.message}`); }
  if (values.json !== '-') console.error(error.message);
  process.exitCode = error.exitCode || 2;
}
