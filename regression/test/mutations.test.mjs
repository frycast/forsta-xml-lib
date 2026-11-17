import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import lulu from '../scenarios/lulu.mjs';
import incentives from '../scenarios/incentives.mjs';
import sample from '../scenarios/sample-only.mjs';
import { loadSurvey, runScenario, select } from '../runner.mjs';

// Mutate ONLY in-memory extracted blocks. No survey XML is ever written.
const mutations = [
  ['advice priority', lulu, 'lulu/advice-priority/3-4', '1652543186', 'ScriptCode', "f('PF15b').any('4','5')", 'false'],
  ['validation flag', lulu, 'lulu/complaint-exclusivity/1-4', '1652543248', 'ValidationCode', 'RaiseError();', '/* mutant */'],
  ['routing boundary', lulu, 'lulu/communication-route/2', '1652543210', 'Expression', '> 1', '> 0'],
  ['completed status is absorbing', sample, 'sample-only/scode/DONE/SCREEN', '1652542302', 'ScriptCode', 'scode_current === completion_scode', 'false'],
  ['dummy exclusion', incentives, 'lulu/incentive/13/0/Y/complete', '1652542168', 'ScriptCode', "f('dummy_sample').get() == 'N'", 'true'],
  ['omnibus partial completion', incentives, 'omnibus/incentive/0/1/N/complete', '1652542168', 'ScriptCode', 'n_sections > 0', 'false'],
  ['queue outcome', lulu, 'lulu/queue/13', '1652540232', 'ScriptCode', "'COMPLETED'", "'RECALL'"],
  ['redirect SID', sample, 'sample-only/redirect-preserves-sid', '1652542314', 'ScriptCode', "'&sid='", "'&wrong='"],
];

for (const [name, cases, id, entity, kind, before, after] of mutations) {
  test(`regression fixtures detect mutation: ${name}`, () => {
    const scenario = cases.find(c => c.id === id);
    assert.ok(scenario, id);
    const original = loadSurvey(scenario.survey);
    const baseline = runScenario(scenario, original);
    assert.equal(baseline.status, 'passed', JSON.stringify(baseline.failure));
    const mutant = structuredClone(original);
    mutant.sha256 = 'in-memory-mutant';
    const block = select(mutant.blocks, { entity, kind });
    assert.ok(block.code.includes(before), `mutation no longer applies: ${before}`);
    block.code = block.code.replace(before, after);
    block.sha256 = createHash('sha256').update(block.code).digest('hex');
    const result = runScenario(scenario, mutant);
    assert.equal(result.status, 'failed', 'fixture must catch the changed business behaviour');
    assert.ok(result.failure.source);
    assert.ok(!result.failure.message.includes('Mock contract'), 'mutation must fail a business assertion, not a missing mock');
  });
}
