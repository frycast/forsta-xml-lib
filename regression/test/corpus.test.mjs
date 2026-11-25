import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, cpSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { root, loadSurvey, loadSurveys, runScenario, select } from '../runner.mjs';
import { allCases, catalogue, exampleCases, selectedSources, checkProvenance, readFixtures } from '../corpus.mjs';

const cli = resolve(root, 'regression/cli.mjs');
const cases = await allCases();
const corpusCases = readFixtures(resolve(root, 'regression/corpus/fixtures.json'));
const temporary = t => { const p = mkdtempSync(join(tmpdir(), 'forsta-corpus-')); t.after(() => rmSync(p, { recursive: true, force: true })); return p; };
function invoke(args, cwd = root, target = cli) {
  const child = spawnSync(process.execPath, [target, ...args, '--json', '-'], { cwd, encoding: 'utf8', timeout: 30000 });
  assert.ok(!child.error, String(child.error));
  return { ...child, report: JSON.parse(child.stdout) };
}
const pass = r => assert.equal(r.status, 'passed', JSON.stringify(r.failure));
function synthetic(t, xml) {
  const file = join(temporary(t), 'contract.xml');
  writeFileSync(file, `<Project><ProjectInfo/><Questionnaire><Routing><Nodes>${xml}</Nodes></Routing></Questionnaire></Project>`);
  return loadSurveys([file])[0];
}

test('every case belongs to one versioned example and source selectors resolve', () => {
  const freshness = checkProvenance(cases);
  assert.equal(freshness.status, 'current', JSON.stringify(freshness.stale.map(({ id, reason, expected, actual }) => ({ id, reason, differingKeys: expected && actual ? Object.keys(actual).filter(key => JSON.stringify(expected[key]) !== JSON.stringify(actual[key])) : [], expectedSurvey: expected?.survey, actualSurvey: actual?.survey, expectedHash: expected?.sha256, actualHash: actual?.sha256, expectedBlocks: expected?.blocks?.length, actualBlocks: actual?.blocks?.length, expectedNodes: expected?.nodes?.length, actualNodes: actual?.nodes?.length })), null, 2));
  const assigned = new Map();
  for (const e of catalogue().examples) {
    const selected = exampleCases(e, cases);
    const sources = selectedSources(e, cases);
    assert.ok(sources.blocks.length);
    for (const c of selected) assigned.set(c.id, (assigned.get(c.id) || 0) + 1);
  }
  assert.equal(assigned.size, cases.length);
  for (const n of assigned.values()) assert.equal(n, 1);
});

test('set contract: field union, difference, mutators, domain and null', t => {
  const survey = synthetic(t, `<Multi EntityId="mask"><Name>target</Name><PrecodeMask><![CDATA[
    var selected = f('prior').union(set('97',97));
    selected.add('99'); selected.remove('97');
    selected.diff(a('excluded'));
  ]]></PrecodeMask></Multi>`);
  const scenario = { id: 'set-contract', given: { fields: { prior: ['1','2','1'] }, domains: { excluded: ['2'] } },
    steps: [{ mask: { entity: 'mask', kind: 'PrecodeMask' }, equals: ['1','99'] }], expect: {} };
  pass(runScenario(scenario, survey));
  const missing = structuredClone(scenario); delete missing.given.domains;
  assert.equal(runScenario(missing, survey).failure.code, 'MISSING_FIXTURE');
  const badDomain = structuredClone(scenario); badDomain.given.domains.excluded = null;
  assert.equal(runScenario(badDomain, survey).failure.code, 'MOCK_CONTRACT');
  const empty = structuredClone(scenario); empty.given.fields.prior = null; empty.steps[0].equals = ['99'];
  pass(runScenario(empty, survey));
  const invalid = structuredClone(scenario); invalid.given.fields.prior = { bad: true };
  assert.equal(runScenario(invalid, survey).failure.code, 'MOCK_CONTRACT');
  const bool = structuredClone(survey); bool.blocks[0].code = 'true';
  assert.match(runScenario(scenario, bool).failure.message, /set or field/);
});

test('callable routing returns to siblings, supports nested conditions and stops terminally', t => {
  const survey = synthetic(t, `<Folder EntityId="section"><Nodes>
    <CallBlock EntityId="call" BlockToCallEntityId="target"/>
    <Script EntityId="after"><ScriptCode>f('x').set('after')</ScriptCode></Script>
    </Nodes></Folder>
    <CallableBlock EntityId="target" Order="InOrder"><Nodes>
    <Condition EntityId="condition" ElseEnabled="true"><Expression>f('stop').toBoolean()</Expression>
    <TrueNodes><Stop EntityId="halt" StopType="Screened" ITS="14"/></TrueNodes>
    <FalseNodes><Script EntityId="inside"><ScriptCode>f('x').set('inside')</ScriptCode></Script></FalseNodes>
    </Condition></Nodes></CallableBlock>`);
  const scenario = { id: 'call', given: { fields: { stop: null, x: null } }, steps: [{ route: { entity: 'section' } }],
    expect: { writes: [['x','inside'],['x','after']], visited: ['section','call','target','condition','inside','after'] } };
  pass(runScenario(scenario, survey));
  pass(runScenario({ ...scenario, given: { fields: { stop: '1', x: null } }, expect: {
    writes: [], visited: ['section','call','target','condition','halt'], halt: { kind:'stop', entity:'halt', stopType:'Screened', extendedStatus:'14' } } }, survey));
  const random = structuredClone(survey); select(random.nodes,{entity:'target'}).attrs.Order='Randomize';
  assert.equal(runScenario(scenario, random).failure.code, 'UNSUPPORTED');
  const missing = structuredClone(survey); select(missing.nodes,{entity:'call'}).attrs.BlockToCallEntityId='absent';
  assert.match(runScenario(scenario, missing).failure.message,/matched 0/);
  const recursive = structuredClone(survey); select(recursive.nodes,{entity:'target'}).children.Nodes = [select(recursive.nodes,{entity:'call'}).key];
  assert.match(runScenario(scenario, recursive).failure.message,/Unsupported recursive CallBlock/);
});

test('extraction exposes exact structure hashes, numeric/sample flags, and piping without evaluation', t => {
  const xml = `<Open EntityId="q" Numeric="true" VariableType="Background" UpperLimit="12"><Name>Q</Name><FormTexts><Text>^f('sample').get()^</Text></FormTexts></Open>`;
  const survey = synthetic(t, xml), q = select(survey.nodes, { entity: 'q' });
  assert.equal(q.sha256, createHash('sha256').update(xml).digest('hex'));
  assert.equal(q.structure.attrs.VariableType, 'Background');
  assert.equal(q.attrs.Numeric, 'true');
  assert.equal(survey.surfaces[0].support, 'piping-not-evaluated');
  assert.equal(survey.blocks.length, 0);
  const utf16Path=join(temporary(t),'utf16.xml');
  writeFileSync(utf16Path,Buffer.from('\ufeff<?xml version="1.0" encoding="UTF-16"?><Project><ProjectInfo/>'+xml+'</Project>','utf16le'));
  const utf16=loadSurveys([utf16Path])[0];
  assert.equal(utf16.nodes[0].sha256,createHash('sha256').update(Buffer.from(xml,'utf16le')).digest('hex'));
  const selfClosing = synthetic(t, '<CallBlock EntityId="c" BlockToCallEntityId="x"/>');
  assert.equal(selfClosing.nodes[0].sha256, createHash('sha256').update('<CallBlock EntityId="c" BlockToCallEntityId="x"/>').digest('hex'));
});

for (const [id, entity, kind, before, after] of [
  ['corpus/mask-union/empty', '1652542451', 'PrecodeMask', "set('97','99')", "set('97')"],
  ['corpus/months-worked/1-13-answered', '1652542194', 'ValidationCode', 'num1 <= 12', 'num1 <= 13'],
  ['corpus/grid-clear/5-2', '1652542497', 'ValidationCode', ".item('a').set(null)", ".item('a').set('5')"],
  ['corpus/device-mask/7-2-na', '1652542286', 'ScriptCode', "st.remove('1')", "st.remove('3')"],
]) test(`corpus detects business mutation ${id}`, () => {
  const scenario = corpusCases.find(c => c.id === id); assert.ok(scenario);
  const original = loadSurvey(scenario.survey); pass(runScenario(scenario, original));
  const mutated = structuredClone(original), block = select(mutated.blocks, {entity,kind});
  assert.ok(block.code.includes(before)); block.code = block.code.replace(before, after);
  block.sha256 = createHash('sha256').update(block.code).digest('hex');
  const result = runScenario(scenario, mutated);
  assert.equal(result.status, 'failed'); assert.equal(result.failure.code, 'ASSERTION_FAILED');
  assert.ok(result.failure.source); assert.ok(Object.hasOwn(result.failure,'expected'));
  assert.ok(Object.hasOwn(result.failure,'actual')); assert.ok(result.actual.trace);
});

test('CLI discovery, inspection and portable fixtures work from another cwd', t => {
  const dir = temporary(t);
  let r = invoke(['examples','mask','--api','set','--type','Multi'], dir);
  assert.equal(r.status,0); assert.ok(r.report.examples.some(e=>e.id==='mask/selected-plus-exclusive'));
  r = invoke(['fixture','routing/single-followup'], dir); assert.equal(r.status,0);
  const fixture = join(dir,'fixture.json'); writeFileSync(fixture, JSON.stringify(r.report));
  const file = join(dir,'changed survey.xml'); const original = readFileSync(resolve(root,'surveys/lina_shell/shell-0/3522RL-p624569876868.xml'),'utf8');
  writeFileSync(file, original);
  r = invoke(['test',file,'--fixtures',fixture], dir); assert.equal(r.status,0); assert.equal(r.report.passed,3);
  assert.equal(r.stderr,'');
  r = invoke(['inspect',file,'--entity','1652543210'],dir);
  assert.equal(r.status,0); assert.ok(r.report.blocks.length); assert.ok(r.report.ancestors.length);
  const source = select(loadSurvey('surveys/lina_shell/shell-0/3522RL-p624569876868.xml').blocks,{entity:'1652543210',kind:'Expression'});
  const encoded = source.code.replaceAll('&','&amp;').replaceAll('>','&gt;').replaceAll('<','&lt;');
  assert.equal(original.split(encoded).length,2,'worked source expression must be unique');
  writeFileSync(file,original.replace(encoded,encoded.replace('&gt; 1','&gt; 0')));
  r = invoke(['test',file,'--fixtures',fixture],dir); assert.equal(r.status,1);
  const failure=r.report.results.find(x=>x.status==='failed');
  assert.ok(failure.failure.source); assert.ok(Object.hasOwn(failure.failure,'expected'));
  assert.ok(failure.actual.trace); assert.equal(readFileSync(resolve(root,'surveys/lina_shell/shell-0/3522RL-p624569876868.xml'),'utf8'),original);
});

test('CLI reports missing values, unsupported routes, invalid input and deterministic JSON', t => {
  const dir = temporary(t), fixture=join(dir,'cases.json'), file=resolve(root,'surveys/lina_shell/shell-0/3522RL-p624569876868.xml');
  const c={id:'missing',steps:[{expression:{entity:'1652543210',kind:'Expression'},equals:true}],given:{},expect:{}};
  const write=c=>writeFileSync(fixture,JSON.stringify({schemaVersion:1,scenarios:[c]}));
  write(c);
  let r=invoke(['test',file,'--fixtures',fixture],dir); assert.equal(r.status,1);assert.equal(r.report.results[0].failure.code,'MISSING_FIXTURE');
  write({...c,steps:[{route:{entity:'1652543274'}}]});
  r=invoke(['test',file,'--fixtures',fixture],dir);assert.equal(r.status,1);assert.equal(r.report.results[0].failure.code,'UNSUPPORTED');
  write({...c,given:{fields:{A10:['1','2']}}});
  const a=invoke(['test',file,'--fixtures',fixture],dir),b=invoke(['test',file,'--fixtures',fixture],dir);
  assert.equal(a.status,0);assert.equal(a.stdout,b.stdout);
  for (const args of [['test',file],['test',file,'--example','routing/single-followup'],['examples','--case','typo'],['inspect',file,'--entity','x','--name','y']]) {
    r=invoke(args,dir);assert.equal(r.status,2);assert.ok(r.report.error.code);
  }
  writeFileSync(fixture,'invalid JSON');r=invoke(['test',file,'--fixtures',fixture],dir);assert.equal(r.status,2);
  write({...c,given:{fields:{A10:['1','2']}}});
  r=invoke(['test',file,'--fixtures',fixture,'--junit',join(fixture,'impossible.xml')],dir);
  assert.equal(r.status,2);assert.ok(r.report.error); // Exactly one parseable JSON error, no preceding success.

});

test('CLI detects changed and removed source blocks as stale in a disposable checkout', t => {
  const dir=temporary(t);cpSync(resolve(root,'regression'),join(dir,'regression'),{recursive:true});
  mkdirSync(join(dir,'surveys'));
  for (const file of new Set(catalogue().examples.map(e=>e.survey))) {
    const destination = join(dir, file);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(resolve(root, file), destination);
  }
  const target=join(dir,'regression/cli.mjs'), path=join(dir,'surveys/lina_shell/shell-0/3522RL-p624569876868.xml');
  const original=readFileSync(path,'utf8');
  writeFileSync(path,original.replace("f('A10').size() &gt; 1", "f('A10').size() &gt; 0"));
  let r=invoke(['corpus','check'],dir,target);assert.equal(r.status,4);assert.equal(r.report.status,'stale');
  r=invoke(['test','--case','communication-route'],dir,target);assert.equal(r.status,4);assert.deepEqual(r.report.results,[]);
  writeFileSync(path,original.replace('EntityId="1652543210"','EntityId="removed"'));
  r=invoke(['corpus','check'],dir,target);assert.equal(r.status,4);assert.match(r.report.stale[0].reason,/no longer resolves/);
});
