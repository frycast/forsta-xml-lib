import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { relative, resolve } from 'node:path';
import vm from 'node:vm';

export const root = fileURLToPath(new URL('../', import.meta.url));
const extractor = fileURLToPath(new URL('./extract.py', import.meta.url));
const runtime = readFileSync(new URL('./runtime.js', import.meta.url), 'utf8');
const cache = new Map();
process.env.TZ = 'UTC';

export function loadSurveys(files) {
  const result = spawnSync(process.env.PYTHON || 'python3', [extractor, ...files], {
    encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, timeout: 60000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`XML extraction failed: ${result.error?.message || result.stderr.trim()}`);
  }
  return JSON.parse(result.stdout).map(survey => {
    survey.file = relative(root, resolve(survey.file)).replaceAll('\\', '/');
    return survey;
  });
}

export function loadSurvey(file) {
  const path = resolve(root, file);
  if (!cache.has(path)) cache.set(path, loadSurveys([path])[0]);
  return cache.get(path);
}

function checkedKeys(object, allowed, label) {
  assert.ok(object && typeof object === 'object' && !Array.isArray(object), `${label} must be an object`);
  for (const key of Object.keys(object)) assert.ok(allowed.includes(key), `${label}: unknown key ${key}`);
}

export function select(items, selector, label = 'block') {
  checkedKeys(selector, ['key', 'entity', 'name', 'kind'], 'selector');
  assert.ok(['key', 'entity', 'name'].some(k => Object.hasOwn(selector, k)), 'selector requires key, entity or name');
  const matches = items.filter(item => Object.entries(selector).every(([k, v]) => item[k] === v));
  assert.equal(matches.length, 1, `${label} selector ${JSON.stringify(selector)} matched ${matches.length}; use an exact key to disambiguate`);
  return matches[0];
}

function sourceCode(block) {
  if (block.environment !== 'server') throw new Error(`Unsupported browser block: ${block.key}`);
  // Script completion values also handle exported expressions with a trailing
  // semicolon/comment without rewriting the original source.
  return block.code;
}

export function compileStatus(block) {
  if (block.environment !== 'server') return 'browser-not-executed';
  try { new vm.Script(sourceCode(block)); return 'compiles'; }
  catch { return 'unsupported-syntax'; }
}

// A process per case also bounds memory and total run time, including VM setup
// and result serialisation. Pass only synthetic fixtures; do not inherit secrets.
export function runScenario(scenario, survey = loadSurvey(scenario.survey)) {
  const worker = spawnSync(process.execPath, ['--max-old-space-size=128', fileURLToPath(new URL('./worker.mjs', import.meta.url))], {
    input: JSON.stringify({ scenario, survey }), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    timeout: 3000, killSignal: 'SIGKILL', env: { TZ: 'UTC', LANG: 'C' },
  });
  if (!worker.error && worker.status === 0) {
    try { return JSON.parse(worker.stdout); } catch { /* malformed worker output */ }
  }
  return { id: scenario.id, survey: survey.file, surveyHash: survey.sha256, status: 'failed',
    blocks: [], decisions: [], visited: [], omittedHooks: [], halt: null,
    failure: { step: 0, source: null, scriptLocation: null,
      message: `Isolated worker failed: ${worker.error?.message || worker.signal || `exit ${worker.status}`}` } };
}

// Worker entry point; use runScenario for normal callers.
export function executeScenario(scenario, survey) {
  const result = {
    id: scenario.id, survey: survey.file, surveyHash: survey.sha256, status: 'failed',
    blocks: [], decisions: [], visited: [], omittedHooks: [], halt: null,
  };
  let context, currentSource, stepIndex = -1;
  const run = (code, filename = 'forsta-mock') => new vm.Script(code, { filename })
    .runInContext(context, { timeout: 150, breakOnSigint: true });
  try {
    checkedKeys(scenario, ['id', 'survey', 'given', 'steps', 'expect'], 'scenario');
    assert.ok(typeof scenario.id === 'string' && scenario.id, 'scenario needs an id');
    assert.ok(Array.isArray(scenario.steps) && scenario.steps.length, 'scenario needs steps');
    assert.ok(!survey.language || survey.language === 'JavaScript', `Unsupported script language ${survey.language}`);
    checkedKeys(scenario.given || {}, ['fields', 'respondent', 'environment', 'query', 'http', 'now', 'seed', 'types', 'domains', 'labels', 'noResponse'], 'given');
    const types = Object.fromEntries(survey.nodes.filter(n => n.name && ['Single', 'Multi'].includes(n.tag)).map(n => [n.name, n.tag]));
    const fixture = { ...scenario.given, types: { ...types, ...scenario.given?.types } };
    context = vm.createContext(Object.assign(Object.create(null), { __fixtureJSON: JSON.stringify(fixture) }), {
      codeGeneration: { strings: false, wasm: false }, microtaskMode: 'afterEvaluate',
    });
    run(runtime);
    const evaluate = block => {
      currentSource = { key: block.key, entity: block.entity, name: block.name, kind: block.kind, xmlLine: block.line };
      result.blocks.push({ key: block.key, kind: block.kind, sha256: block.sha256 });
      const filename = `${survey.file}#${block.entity}/${block.kind}.js`;
      return run(sourceCode(block), filename);
    };
    const decide = block => {
      const answer = evaluate(block);
      assert.equal(typeof answer, 'boolean', 'route condition must return a boolean');
      result.decisions.push({ key: block.key, value: answer });
      return answer;
    };
    const nodes = new Map(survey.nodes.map(n => [n.key, n]));
    const questions = new Set(['Info', 'Open', 'Single', 'Multi', 'Grid', 'Grid3D']);
    const route = node => {
      if (result.halt) return;
      assert.ok(node, 'route references an unsupported or missing XML node');
      if (result.visited.length >= 1000) throw new Error('Route visit limit exceeded');
      currentSource = { key: node.key, entity: node.entity, name: node.name, xmlLine: node.line };
      result.visited.push(node.entity);
      const directBlocks = survey.blocks.filter(b => b.key.startsWith(`${node.key}/`) && !b.key.slice(node.key.length + 1).includes('/'));
      const children = container => (node.children[container] || []).forEach(key => route(nodes.get(key)));
      if (node.tag === 'Condition') {
        const block = select(directBlocks, { entity: node.entity, kind: 'Expression' });
        if (decide(block)) children('TrueNodes');
        else if (node.attrs.ElseEnabled === 'true') children('FalseNodes');
      } else if (node.tag === 'Script') {
        evaluate(select(directBlocks, { entity: node.entity, kind: 'ScriptCode' }));
      } else if (['Folder', 'Page'].includes(node.tag)) children('Nodes');
      else if (node.tag === 'Stop') {
        result.halt = { kind: 'stop', entity: node.entity, stopType: node.attrs.StopType, extendedStatus: node.attrs.ITS };
      } else if (questions.has(node.tag)) {
        // This is a routing slice, not an interview engine. Answers are preseeded.
        result.omittedHooks.push(...survey.blocks.filter(b => b.key.startsWith(`${node.key}/`)).map(b => b.key));
      } else if (node.tag !== 'Note') throw new Error(`Unsupported route node ${node.tag}`);
    };

    for (const [index, step] of scenario.steps.entries()) {
      if (result.halt) break;
      stepIndex = index;
      currentSource = null;
      checkedKeys(step, ['script', 'expression', 'route', 'equals', 'currentForm'], 'step');
      const operations = ['script', 'expression', 'route'].filter(key => Object.hasOwn(step, key));
      assert.equal(operations.length, 1, 'step must select exactly one operation');
      assert.ok(!Object.hasOwn(step, 'equals') || step.expression, 'equals is only valid on an expression step');
      if (Object.hasOwn(step, 'currentForm')) run(`__setCurrentForm(${JSON.stringify(step.currentForm)})`);
      try {
        if (step.route) route(select(survey.nodes, step.route, 'route node'));
        else {
          const block = select(survey.blocks, step.script || step.expression);
          if (step.expression) {
            assert.equal(block.mode, 'expression', 'expression step must select an expression');
            assert.ok(Object.hasOwn(step, 'equals'), 'expression step needs equals');
            assert.equal(decide(block), step.equals, 'condition result');
          } else {
            assert.notEqual(block.mode, 'expression', 'use expression step for expression blocks');
            evaluate(block);
          }
        }
      } catch (error) {
        if (error.forstaHalt === 'redirect') result.halt = { kind: 'redirect' };
        else throw error;
      }
    }
    result.actual = JSON.parse(run('__snapshot()'));
    const expected = scenario.expect;
    checkedKeys(expected, ['fields', 'respondent', 'environment', 'effects', 'writes', 'validationFailed', 'messages', 'visited', 'halt'], 'expect');
    for (const section of ['fields', 'respondent', 'environment']) {
      for (const [key, expectedValue] of Object.entries(expected[section] || {})) {
        assert.deepEqual(result.actual[section][key], expectedValue, `${section}.${key}`);
      }
    }
    // Every external/state API write must be expected, even in otherwise empty cases.
    assert.deepEqual(result.actual.effects, expected.effects || [], 'effects (ordered, exact)');
    assert.equal(result.actual.validationFailed, expected.validationFailed ?? false, 'validationFailed');
    assert.deepEqual(result.actual.messages, expected.messages || [], 'validation messages');
    assert.deepEqual(result.halt, expected.halt || null, 'halt');
    if (Object.hasOwn(expected, 'visited')) assert.deepEqual(result.visited, expected.visited, 'visited XML entities');
    if (Object.hasOwn(expected, 'writes')) assert.deepEqual(result.actual.trace.filter(x => x.api === 'f.set').map(x => x.args), expected.writes, 'field writes (ordered, exact)');
    assert.equal(result.actual.httpUsed, (scenario.given?.http || []).length, 'unused HTTP expectations');
    result.status = 'passed';
  } catch (error) {
    result.failure = { step: stepIndex + 1, source: currentSource || null,
      scriptLocation: error.stack?.split('\n').find(line => line.includes('.xml#'))?.trim() || null,
      message: error.message };
    // Serialise inside the VM, under the same timeout; never call a VM function on the host.
    if (context) {
      try { result.actual = JSON.parse(run('__snapshot()')); } catch { /* setup/timeout failure */ }
    }
  }
  result.blocks = [...new Map(result.blocks.map(b => [b.key, b])).values()];
  result.omittedHooks = [...new Set(result.omittedHooks)];
  return result;
}

export function coverage(surveys, results) {
  return surveys.map(survey => {
    const cases = results.filter(r => r.survey === survey.file);
    const passed = cases.filter(r => r.status === 'passed');
    const reached = new Set(passed.flatMap(r => r.blocks.map(b => b.key)));
    const decisions = new Map();
    for (const decision of passed.flatMap(r => r.decisions)) {
      if (!decisions.has(decision.key)) decisions.set(decision.key, new Set());
      decisions.get(decision.key).add(decision.value);
    }
    const counts = {};
    for (const block of survey.blocks) {
      const key = `${block.environment}/${block.kind}`;
      counts[key] ??= { total: 0, reachedInPassingCases: 0 };
      counts[key].total++;
      if (reached.has(block.key)) counts[key].reachedInPassingCases++;
    }
    return {
      survey: survey.file, sha256: survey.sha256, cases: cases.length, passed: passed.length,
      blocks: counts, conditionsWithBothOutcomes: [...decisions.values()].filter(s => s.size === 2).length,
      unexecutedSurfaces: survey.unexecutedSurfaces,
    };
  });
}

export function junit(results) {
  const xml = value => String(value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
    .replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="Forsta XML regression" tests="${results.length}" failures="${results.filter(r => r.status === 'failed').length}">\n` + results.map(r =>
    `  <testcase classname="${xml(r.survey)}" name="${xml(r.id)}">${r.failure ? `<failure message="${xml(r.failure.message)}">${xml(JSON.stringify({ failure: r.failure, trace: r.actual?.trace }, null, 2))}</failure>` : ''}</testcase>`
  ).join('\n') + '\n</testsuite>\n';
}
