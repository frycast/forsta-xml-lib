import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { root, loadSurvey, select, compileStatus } from './runner.mjs';

export const corpusPath = resolve(root, 'regression/corpus');
export const readJSON = path => JSON.parse(readFileSync(path, 'utf8'));
export function readFixtures(path) {
  const data = readJSON(path);
  assert.ok(data && data.schemaVersion === 1 && Array.isArray(data.scenarios), 'fixtures need schemaVersion: 1 and scenarios: []');
  assert.ok(Object.keys(data).every(k => ['schemaVersion', 'scenarios'].includes(k)), 'unknown fixture document key');
  return data.scenarios;
}
export async function loadCases(suite) {
  const cases = [];
  for (const name of readdirSync(suite).filter(n => n.endsWith('.mjs')).sort()) {
    const path = resolve(suite, name);
    const loaded = (await import(pathToFileURL(path))).default;
    assert.ok(Array.isArray(loaded), `${name} must export scenarios`);
    cases.push(...loaded);
  }
  return cases;
}
export async function allCases() {
  return [...await loadCases(resolve(root, 'regression/scenarios')), ...readFixtures(resolve(corpusPath, 'fixtures.json'))];
}
export function catalogue() {
  const data = readJSON(resolve(corpusPath, 'catalogue.json'));
  assert.equal(data.schemaVersion, 1, 'unsupported catalogue version');
  assert.equal(new Set(data.examples.map(e => e.id)).size, data.examples.length, 'duplicate example IDs');
  for (const e of data.examples) {
    assert.match(e.id, /^[a-z0-9-]+\/[a-z0-9-]+$/);
    for (const key of ['title', 'survey', 'use', 'status']) assert.ok(typeof e[key] === 'string' && e[key], `${e.id}: needs ${key}`);
    for (const key of ['selectors', 'scenarioPrefixes', 'tags', 'questionTypes', 'apis', 'requirements', 'limitations', 'observations']) assert.ok(Array.isArray(e[key]), `${e.id}: needs ${key}`);
  }
  return data;
}
export function example(id) {
  const result = catalogue().examples.find(e => e.id === id);
  assert.ok(result, `Unknown example ${id}; use examples to discover IDs`);
  return result;
}
export function exampleCases(entry, cases) {
  const selected = cases.filter(c => entry.scenarioPrefixes.some(p => p.endsWith('/') ? c.id.startsWith(p) : c.id === p));
  assert.ok(selected.length, `${entry.id}: no fixtures matched`);
  assert.ok(selected.every(c => c.survey === entry.survey), `${entry.id}: fixtures point to another survey`);
  return selected;
}
export function selectedSources(entry, cases, survey = loadSurvey(entry.survey)) {
  const selected = exampleCases(entry, cases);
  const nodes = new Map(), blocks = new Map();
  const addNode = selector => {
    const node = select(survey.nodes, selector, 'structure');
    if (nodes.has(node.key)) return;
    nodes.set(node.key, node);
    for (const b of survey.blocks.filter(b => b.key.startsWith(node.key + '/'))) blocks.set(b.key, b);
    for (const child of survey.nodes.filter(n => n.key.startsWith(node.key + '/'))) nodes.set(child.key, child);
    // Follow actual callable links, never a name heuristic. Also hash their targets.
    for (const n of [...nodes.values()]) {
      if (n.tag === 'CallBlock' && n.attrs.BlockToCallEntityId && ![...nodes.values()].some(t => t.entity === n.attrs.BlockToCallEntityId))
        addNode({ entity: n.attrs.BlockToCallEntityId });
    }
  };
  const addBlock = selector => { const b = select(survey.blocks, selector); blocks.set(b.key, b); };
  for (const selector of entry.selectors) selector.kind ? addBlock(selector) : addNode(selector);
  for (const c of selected) for (const step of c.steps) {
    if (step.route) addNode(step.route); else addBlock(step.script || step.expression || step.mask);
  }
  const surfaces = (survey.surfaces || []).filter(s => [...nodes.keys()].some(k => s.key.startsWith(k + '/')));
  return { nodes: [...nodes.values()], blocks: [...blocks.values()], surfaces };
}
export function provenance(cases, revision) {
  const data = catalogue();
  return { schemaVersion: 1, corpusVersion: data.version, revision,
    catalogueHash: createHash('sha256').update(readFileSync(resolve(corpusPath, 'catalogue.json'))).digest('hex'),
    examples: data.examples.map(e => {
      const survey = loadSurvey(e.survey), sources = selectedSources(e, cases, survey);
      return { id: e.id, survey: survey.file, sha256: survey.sha256,
        blocks: sources.blocks.map(({ key, entity, kind, sha256 }) => ({ key, entity, kind, sha256 })),
        nodes: sources.nodes.map(({ key, entity, tag, sha256 }) => ({ key, entity, tag, sha256 })) };
    }) };
}
export function checkProvenance(cases) {
  const locked = readJSON(resolve(corpusPath, 'sources.lock.json'));
  let current;
  try { current = provenance(cases, locked.revision); }
  catch (error) { return { status: 'stale', revision: locked.revision,
    stale: [{ id: 'catalogue', reason: `source/fixture no longer resolves: ${error.message}` }] }; }
  const stale = [];
  if (locked.schemaVersion !== 1 || current.catalogueHash !== locked.catalogueHash || current.corpusVersion !== locked.corpusVersion)
    stale.push({ id: 'catalogue', reason: 'catalogue/version changed; review and relock' });
  for (const e of current.examples) {
    const previous = locked.examples.find(x => x.id === e.id);
    if (JSON.stringify(previous) !== JSON.stringify(e)) stale.push({ id: e.id, reason: 'source changed; review fixtures, dependencies and limitations', expected: previous || null, actual: e });
  }
  return { status: stale.length ? 'stale' : 'current', revision: locked.revision, stale };
}
export function inspectSurvey(survey, selector) {
  const nodeMatches = selector ? survey.nodes.filter(n => Object.entries(selector).every(([k,v]) => n[k] === v)) : [];
  const selected = selector ? (nodeMatches.length ? select(survey.nodes, selector, 'structure') : select(survey.blocks, selector, 'block')) : null;
  const inScope = item => !selected || item.key === selected.key || item.key.startsWith(selected.key + '/');
  const nodes = survey.nodes.filter(inScope), blocks = survey.blocks.filter(inScope);
  const supported = new Set(['Condition', 'Script', 'Folder', 'Page', 'CallableBlock', 'CallBlock', 'Stop', 'Info', 'Open', 'Single', 'Multi', 'Grid', 'Grid3D', 'Note']);
  return { schemaVersion: 1, file: survey.file, sha256: survey.sha256, name: survey.name,
    ancestors: selected ? survey.nodes.filter(n => selected.key.startsWith(n.key + '/')).map(({key, entity, name, tag}) => ({key, entity, name, tag})) : [],
    nodes, blocks: blocks.map(b => ({ ...b, compileStatus: compileStatus(b) })),
    surfaces: (survey.surfaces || []).filter(inScope),
    unsupported: [
      ...nodes.filter(n => !supported.has(n.tag)).map(n => ({ key: n.key, entity: n.entity, reason: `route ${n.tag} is not modelled` })),
      ...nodes.filter(n => n.structuredPredicate && !blocks.some(b => b.key === n.key + '/Expression[1]')).map(n => ({ key: n.key, entity: n.entity, reason: 'structured-only predicate' })),
      ...nodes.filter(n => n.attrs.Order && n.attrs.Order !== 'InOrder').map(n => ({ key: n.key, entity: n.entity, reason: `route order ${n.attrs.Order} is not modelled` })),
      ...blocks.filter(b => compileStatus(b) !== 'compiles').map(b => ({ key: b.key, entity: b.entity, reason: compileStatus(b) })),
    ], limitations: ['Static inventory is not an API support check. Run explicit fixtures to discover missing values and APIs.', 'Question visits omit hooks, masks, requiredness and rendering. Text piping is inspection only.', 'Explicit selectors start at a subtree; ancestor conditions are not executed.'] };
}
