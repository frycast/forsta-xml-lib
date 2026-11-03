import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { compileStatus, coverage, junit, loadSurveys, root, runScenario, select } from '../runner.mjs';

function synthetic(code, mode = 'script') {
  return { file: 'synthetic.xml', sha256: 'synthetic', nodes: [], unexecutedSurfaces: {},
    blocks: [{ key: '/Script[1]/ScriptCode[1]', entity: 's1', name: 'synthetic',
      kind: 'ScriptCode', mode, environment: 'server', line: 1, code, sha256: 'synthetic' }] };
}
function run(code, given = {}, expect = {}) {
  return runScenario({ id: 'test', survey: 'synthetic.xml', given,
    steps: [{ script: { entity: 's1' } }], expect }, synthetic(code));
}
function pass(result) { assert.equal(result.status, 'passed', JSON.stringify(result.failure)); }
function fail(result, pattern) {
  assert.equal(result.status, 'failed');
  assert.match(result.failure.message, pattern);
}
function extract(xml, t) {
  const dir = mkdtempSync(join(tmpdir(), 'forsta-extract-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'fixture.xml');
  writeFileSync(path, xml);
  return loadSurveys([path])[0];
}

test('extracts real XML contexts, CDATA, attributes and browser code without double decoding', t => {
  const survey = extract(`\ufeff<?xml version="1.0"?><Project><ProjectInfo ProjectId="fixture" ScriptCodeType="JavaScript" GlobalQuestionValidationCode="f(&quot;x&quot;).set(&quot;&amp;lt;&quot;)"/>
    <Questionnaire><Routing><Nodes>
    <!-- <Script EntityId="fake"><ScriptCode>DO_NOT_EXTRACT</ScriptCode></Script> -->
    <Script EntityId="s"><Name>Named</Name><ScriptCode><![CDATA[if (1 < 2) f('x').set('&lt;');]]></ScriptCode></Script>
    <Single EntityId="q"><Name>Q1</Name><ValidationCode>f('x').set(1 &lt; 2)</ValidationCode><StartupScript>document.ready()</StartupScript>
      <FormTexts><FormText><Text>&lt;script src="https://example.invalid/x.js"&gt;&lt;/script&gt;&lt;script&gt;console.log(1)&lt;/script&gt;</Text></FormText></FormTexts>
      <SingleAnswers><Answer Precode="1"><Expression>f('x').any('1')</Expression></Answer><Answer Precode="2"><Expression>f('x').any('2')</Expression></Answer></SingleAnswers>
    </Single><Script EntityId="empty"><ScriptCode> </ScriptCode></Script>
    </Nodes></Routing></Questionnaire></Project>`, t);
  assert.equal(survey.blocks.length, 7);
  assert.equal(survey.blocks[0].code, 'f("x").set("&lt;")');
  assert.equal(survey.blocks[1].code, "if (1 < 2) f('x').set('&lt;');");
  assert.ok(survey.blocks[1].line > 1);
  assert.equal(survey.blocks.filter(b => b.environment === 'browser').length, 2);
  assert.equal(survey.unexecutedSurfaces.externalBrowserScripts, 1);
  assert.throws(() => select(survey.blocks, { entity: 'q', kind: 'Expression' }), /matched 2/);
  assert.equal(new Set(survey.blocks.map(b => b.key)).size, 7);
  assert.equal(select(survey.blocks, { key: survey.blocks[1].key }).name, 'Named');
});

test('rejects malformed XML, DTDs and non-Forsta roots', t => {
  for (const xml of ['<Project>', '<!DOCTYPE Project [<!ENTITY a "secret">]><Project/>', '<Other/>']) {
    assert.throws(() => extract(xml, t), /XML extraction failed/);
  }
});

test('selectors and expectation typos fail instead of skipping assertions', () => {
  assert.throws(() => select([], { entity: 'missing' }), /matched 0/);
  assert.throws(() => select([], {}), /selector requires/);
  fail(run('', {}, { field: {} }), /unknown key field/);
  const survey = synthetic('true', 'expression');
  fail(runScenario({ id: 'bad', given: {}, steps: [{ expression: { entity: 's1' } }], expect: {} }, survey), /needs equals/);
});

test('strict field, sample, query, environment and API contracts', () => {
  fail(run("f('typo').get()"), /undeclared field typo/);
  fail(run("f('typo').set(1)"), /undeclared field typo/);
  fail(run("GetRespondentValue('missing')"), /undeclared respondent/);
  fail(run("Request.QueryString.item('missing')"), /undeclared query/);
  fail(run('GetStatus()'), /undeclared environment status/);
  fail(run('UndocumentedForstaAPI()'), /not defined/);
  fail(run("f('x').unmodelled()", { fields: { x: null } }), /not a function/);
  pass(run("f('x').set(f('y')); f('loop',f('index')).item('r').set(42)", {
    fields: { x: null, y: ['2'], index: '1', 'loop[1][r]': null }, types: { x: 'Single' },
  }, { fields: { x: '2', 'loop[1][r]': 42 }, writes: [['x', '2'], ['loop[1][r]', 42]] }));
});

test('field model handles answered zero, missing, multicode and explicit metadata', () => {
  pass(run(`
    if (!f('zero').toBoolean() || f('empty').toBoolean()) throw Error('answered semantics');
    if (!f('multi').all(1,2) || !f('multi').none(3) || f('multi').size() !== 2) throw Error('codes');
    if (f('nr').getNoResponseValue() !== 'DK') throw Error('no response');
    if (f('grid').item('1').label() !== 'Row') throw Error('label');
    if (f('multi').domainValues().length !== 3) throw Error('domain');
  `, { fields: { zero: 0, empty: null, multi: ['1', '2'] }, noResponse: { nr: 'DK' },
    labels: { grid: { 1: 'Row' } }, domains: { multi: ['1', '2', '3'] } }));
  fail(run("f('x').getNoResponseValue()", { fields: { x: null } }), /undeclared noResponse/);
  fail(run("f('single').set(['1','2'])", { fields: { single: null }, types: { single: 'Single' } }), /cannot assign/);
});

test('validation flags an error but does not implicitly stop subsequent business code', () => {
  pass(run("RaiseError(); f('x').set('continued')", { fields: { x: null } },
    { fields: { x: 'continued' }, validationFailed: true }));
});

test('exported expressions accept terminal semicolons but require boolean results', () => {
  const scenario = { id: 'expression', given: {}, steps: [{ expression: { entity: 's1' }, equals: true }], expect: {} };
  pass(runScenario(scenario, synthetic('1 < 2; // exported expression', 'expression')));
  fail(runScenario(scenario, synthetic('"false"', 'expression')), /must return a boolean/);
  fail(run('SetPanelistCredit(NaN,"invalid",-1,"record")'), /finite JSON/);
});

test('effects are exact and ordered; credit attempts are never automatically deduplicated', () => {
  fail(run("SetStatus('complete')"), /effects/);
  const award = { api: 'SetPanelistCredit', args: [10, 'test', -1, 'record'] };
  pass(run("SetPanelistCredit(10,'test',-1,'record'); SetPanelistCredit(10,'test',-1,'record')", {}, { effects: [award, award] }));
  pass(run("Redirect('https://example.invalid', true); throw Error('unreachable')", {}, {
    effects: [{ api: 'Redirect', args: ['https://example.invalid', true] }], halt: { kind: 'redirect' },
  }));
});

test('HTTP is exact, queued, isolated, and rejects unused expectations', () => {
  const http = [{ method: 'Get', args: ['https://example.invalid', '', { token: 'fake' }], response: 'OK' }];
  pass(run("f('x').set(Http.Get('https://example.invalid','',{token:'fake'}))", { fields: { x: null }, http }, {
    fields: { x: 'OK' }, effects: [{ api: 'Http.Get', args: http[0].args }],
  }));
  fail(run("Http.Get('https://example.invalid')"), /unexpected Http.Get/);
  fail(run('', { http }), /unused HTTP expectations/);
  fail(run("Http.Get('https://example.invalid','',{token:'fake'})", { http: [{ ...http[0], error: 'synthetic outage' }] }), /synthetic outage/);
});

test('fixed clock, UTC and seeded randomness repeat without leaking state', () => {
  const code = "f('x').set([Date.now(),new Date().toISOString(),Date(),Math.random(),Math.random()]);";
  const given = { fields: { x: null }, now: '2026-01-01T01:00:00Z', seed: 42 };
  const a = run(code, given); const b = run(code, given);
  pass(a); pass(b);
  assert.deepEqual(a, b);
  assert.equal(a.actual.fields.x[0], 1767229200000);
  assert.equal(a.actual.fields.x[1], '2026-01-01T01:00:00.000Z');
  pass(run("if (f('x').get() !== null) throw Error('leak')", { fields: { x: null } }));
  fail(run('new Date().toLocaleString()'), /not modelled/);
});

test('no host network/process modules are available; dynamic code and loops fail', () => {
  pass(run("for (const name of ['fetch','require','process','XMLHttpRequest','WebSocket']) if (typeof globalThis[name] !== 'undefined') throw Error(name)"));
  fail(run("eval('1+1')"), /Code generation/);
  fail(run("Function('return process')()"), /Code generation/);
  fail(run('while (true) {}'), /timed out/);
  fail(run('Promise.resolve().then(() => { while (true) {} })'), /timed out/);
});

test('syntax and browser incompatibilities remain visible', () => {
  const survey = synthetic('var x:int = 1;');
  assert.equal(compileStatus(survey.blocks[0]), 'unsupported-syntax');
  fail(run('var x:int = 1;'), /Unexpected token/);
  survey.blocks[0].environment = 'browser';
  assert.equal(compileStatus(survey.blocks[0]), 'browser-not-executed');
  fail(runScenario({ id: 'browser', steps: [{ script: { entity: 's1' } }], expect: {} }, survey), /Unsupported browser/);
});

test('route stops are terminal, unknown nodes and structured-only predicates fail', t => {
  const survey = extract(`<Project><ProjectInfo/><Questionnaire><Routing><Nodes>
    <Folder EntityId="folder"><Nodes><Condition EntityId="if" ElseEnabled="true"><Expression>f('x').any('1')</Expression>
      <TrueNodes><Stop EntityId="stop" StopType="Screened" ITS="14"/><Script EntityId="after"><ScriptCode>throw Error('unreachable')</ScriptCode></Script></TrueNodes>
      <FalseNodes><Loop EntityId="loop"/></FalseNodes></Condition></Nodes></Folder>
    <Condition EntityId="predicate"><Predicate><Predicates><SinglePredicate/></Predicates></Predicate></Condition>
    </Nodes></Routing></Questionnaire></Project>`, t);
  const scenario = { id: 'route', given: { fields: { x: '1' } }, steps: [{ route: { entity: 'folder' } }],
    expect: { visited: ['folder', 'if', 'stop'], halt: { kind: 'stop', entity: 'stop', stopType: 'Screened', extendedStatus: '14' } } };
  const result = runScenario(scenario, survey); pass(result);
  fail(runScenario({ ...scenario, given: { fields: { x: '2' } } }, survey), /Unsupported route node Loop/);
  fail(runScenario({ ...scenario, steps: [{ route: { entity: 'predicate' } }] }, survey), /matched 0/);
  const cov = coverage([survey], [result])[0];
  assert.equal(cov.conditionsWithBothOutcomes, 0);
  assert.equal(cov.blocks['server/ScriptCode'].reachedInPassingCases, 0);
});

test('reports contain source and trace, JUnit escapes failure data', () => {
  const result = run("f('x').set('wrong')", { fields: { x: null } }, { fields: { x: 'right' } });
  fail(result, /fields.x/);
  assert.equal(result.failure.source.entity, 's1');
  assert.deepEqual(result.actual.trace, [{ api: 'f.set', args: ['x', 'wrong'] }]);
  result.id = 'quoted " < &';
  assert.match(junit([result]), /quoted &quot; &lt; &amp;/);
  assert.match(junit([result]), /failures="1"/);
});

test('CLI fails empty selection and writes deterministic JSON and valid JUnit', t => {
  const dir = mkdtempSync(join(tmpdir(), 'forsta-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cli = join(root, 'regression/cli.mjs');
  assert.equal(spawnSync(process.execPath, [cli, 'test', '--case', 'DOES-NOT-EXIST']).status, 1);
  const paths = [join(dir, 'a.json'), join(dir, 'b.json')];
  for (const path of paths) {
    const child = spawnSync(process.execPath, [cli, 'test', '--case', 'redirect-preserves-sid', '--json', path, '--junit', join(dir, 'test.xml')], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
  }
  assert.equal(readFileSync(paths[0], 'utf8'), readFileSync(paths[1], 'utf8'));
  const parsed = spawnSync(process.env.PYTHON || 'python3', ['-c', 'import sys,xml.etree.ElementTree as E; r=E.parse(sys.argv[1]).getroot(); assert r.attrib["tests"]=="1"', join(dir, 'test.xml')]);
  assert.equal(parsed.status, 0);
  // Deliberately failing fixture proves exit code and artifacts, not just a unit assertion.
  writeFileSync(join(dir, 'bad.mjs'), `export default [{id:'bad',survey:'surveys/p177291954851.xml',given:{},steps:[{script:{entity:'1652542302',kind:'ScriptCode'}}],expect:{}}];`);
  const child = spawnSync(process.execPath, [cli, 'test', '--suite', dir, '--json', join(dir, 'failure.json'), '--junit', join(dir, 'failure.xml')], { encoding: 'utf8' });
  assert.equal(child.status, 1);
  assert.equal(JSON.parse(readFileSync(join(dir, 'failure.json'))).failed, 1);
  assert.match(child.stderr, /undeclared field scode/);
});
