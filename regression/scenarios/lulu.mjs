const survey = 'surveys/p624569876868.xml';
const script = entity => ({ script: { entity, kind: 'ScriptCode' } });
const cases = [];
const add = (id, given, steps, expect) => cases.push({ id: `lulu/${id}`, survey, given, steps, expect });

// Highest applicable advice category wins; both wording variables must agree.
for (const [selected, category] of [
  [['1'], '1'], [['2'], '1'], [['1', '3'], '2'], [['3', '4'], '3'],
  [['5'], '3'], [['98'], '4'], [['99'], '4'], [[], null],
]) {
  add(`advice-priority/${selected.join('-') || 'empty'}`, {
    fields: { RECONTACT_GROUP: ['1'], PF15b: selected, HID_PF21_1: null, HID_PF21_2: null },
  }, [{ route: { entity: '1652543279' } }], {
    fields: { HID_PF21_1: category, HID_PF21_2: category },
    writes: category === null ? [] : [['HID_PF21_1', category], ['HID_PF21_2', category]],
    visited: ['1652543279', '1652543181', '1652543186', '1652543185', '1652543184', '1652543183', '1652543182'],
  });
}
add('other-recontact-group-skips-advice', { fields: { RECONTACT_GROUP: ['2'] } },
  [{ route: { entity: '1652543279' } }], { visited: ['1652543279'], writes: [] });

for (const [answers, expected, visited] of [
  [[], null, ['1652543210', '1652543209']],
  [['2'], '2', ['1652543210', '1652543209']],
  [['1', '2'], null, ['1652543210', '1652543208']],
]) {
  add(`communication-route/${answers.join('-') || 'empty'}`, { fields: { A10: answers, A11: null } },
    [{ route: { entity: '1652543210' } }], { fields: { A11: expected }, visited,
      writes: expected === null ? [] : [['A11', expected]] });
}

// Exhaust all subsets of codes 1..7, independently expressing the exclusivity rule.
for (let mask = 0; mask < 128; mask++) {
  const answers = Array.from({ length: 7 }, (_, i) => String(i + 1)).filter((_, i) => mask & (1 << i));
  const conflict = answers.includes('1') && answers.some(c => ['4', '5', '6', '7'].includes(c));
  add(`complaint-exclusivity/${answers.join('-') || 'empty'}`, { fields: { A26: answers } },
    [{ script: { entity: '1652543248', kind: 'ValidationCode' }, currentForm: 'A26' }], {
      validationFailed: conflict, writes: [], messages: conflict ? [{ language: 3081,
        message: 'First option cannot be combined with other options selected' }] : [],
    });
}

add('global-validation-fixed-clock-and-loop-cell', {
  now: '2026-01-01T00:01:30.000Z', environment: { currentForm: 'A26' },
  fields: { endQ: null, QPath: '', PagesAnsweredCount: null, total_attempt_count: '1',
    'session_endQ[1]': null, 'start_date_time_UTC[1]': '2026-01-01T00:00:00.000Z', 'session_duration[1]': null },
}, [{ script: { entity: 'ProjectInfo', kind: 'GlobalQuestionValidationCode' } }], {
  fields: { endQ: 'A26', QPath: '|A26', PagesAnsweredCount: 1, 'session_endQ[1]': 'A26', 'session_duration[1]': 90 },
  writes: [['endQ', 'A26'], ['QPath', '|A26'], ['PagesAnsweredCount', '0'], ['PagesAnsweredCount', 1], ['session_endQ[1]', 'A26'], ['session_duration[1]', 90]],
});

// Expected outcomes are a reviewable decision table, including range boundaries.
const queueTable = [
  [13, 'COMPLETED', '1'], [3, 'RECALL'], [7, 'RECALL'], [50, 'RECALL'], [2, 'RECALL'],
  [36, 'RECALL', '1', null, '1'], [1, 'APPOINTMENT', '1'], [33, 'APPOINTMENT', '1'],
  [5, 'REFUSED', '1', 'Failed'], [91, 'REFUSED', '1', 'Failed'], [100, 'REFUSED', '1', 'Failed'],
  [4, 'OVERQUOTA', undefined, 'Failed'], [1051, 'FAILED', '1'],
  [20, 'TRANSFER_TO_WEB', '1'], [71, 'TRANSFER_TO_WEB', '1'],
  [9, 'UNUSABLE', '0'], [11, 'UNUSABLE', '0'], [40, 'UNUSABLE', '1', null, null, 'screened'],
  [60, 'UNUSABLE', '1'], [61, 'UNUSABLE', '1'], [62, 'UNUSABLE', '1'],
  [6, 'UNUSABLE', '1', null, null, 'screened'], [17, 'UNUSABLE', '1', null, null, 'screened'],
  [34, 'UNUSABLE', '1'], [35, 'UNUSABLE', '1', null, '2'],
  [37, 'UNUSABLE', '1', null, null, 'screened'], [38, 'UNUSABLE', '1', null, null, 'screened'],
  [39, 'UNUSABLE', '1'], [41, 'UNUSABLE', '1', 'Failed'], [56, 'UNUSABLE', '0'],
  ...[14, 72, 80, 81, 90].map(s => [s, 'UNUSABLE', '1', 'Failed', null, 'screened']),
  [0], [32], [70], [101],
];
for (const [status, queue, contact, screener, lote, newStatus] of queueTable) {
  const updates = [['queue', queue], ['has_made_contact', contact], ['screener', screener], ['lote_flag', lote]]
    .filter(([, v]) => v !== undefined && v !== null);
  const respondent = { queue: 'INITIAL', has_made_contact: '0', screener: null, lote_flag: null, EarlyCompFlg: 'N' };
  const after = { ...respondent, ...Object.fromEntries(updates) };
  add(`queue/${status}`, { environment: { extendedStatus: status, status: null }, respondent,
    fields: { queue: null, has_made_contact: null, screener: null } }, [script('1652540232')], {
    respondent: after, fields: { queue: after.queue, has_made_contact: after.has_made_contact, screener: after.screener },
    environment: { status: newStatus || null },
    effects: [...updates.map(args => ({ api: 'SetRespondentValue', args })), ...(newStatus ? [{ api: 'SetStatus', args: [newStatus] }] : [])],
  });
}
add('early-complete-queue-override', {
  environment: { extendedStatus: 32 }, respondent: { EarlyCompFlg: 'Y', queue: 'INITIAL', has_made_contact: '0', screener: null },
  fields: { queue: null, has_made_contact: null, screener: null },
}, [script('1652540232')], { fields: { queue: 'COMPLETED', has_made_contact: '1', screener: null },
  effects: [{ api: 'SetRespondentValue', args: ['queue', 'COMPLETED'] }, { api: 'SetRespondentValue', args: ['has_made_contact', '1'] }] });

// The real email-validation script and shared error helper, with synthetic data.
// role_address/disposable are CURRENT BEHAVIOUR characterisations; see findings.
for (const [category, code] of [['valid', null], ['email_domain_invalid', 14], ['email_address_invalid', 15], ['email_account_invalid', 16], ['accept_all', 17], ['role_address', null], ['disposable', null]]) {
  const args = ['https://api.everest.validity.com/api/2.0/validation/addresses/person@example.invalid', '', { 'X-API-Key': 'redacted' }];
  add(`email/${category}`, {
    fields: { EC1_2_other: 'person@example.invalid', EmailCollected: null, EmailReturnValues_category: null, EmailReturnText: null },
    environment: { language: 3081 }, labels: { standarderrormessage: { 14: 'Invalid domain', 15: 'Invalid address', 16: 'Invalid account', 17: 'Check address' } },
    http: [{ method: 'Get', args, response: JSON.stringify({ results: { category } }) }],
  }, [script('1652540440'), { script: { entity: '1652541995', kind: 'ValidationCode' } }], {
    fields: { EmailCollected: 'person@example.invalid', EmailReturnValues_category: JSON.stringify(category), EmailReturnText: JSON.stringify({ category }) },
    effects: [{ api: 'Http.Get', args }], validationFailed: code !== null,
    messages: code ? [{ language: 3081, message: ({ 14: 'Invalid domain', 15: 'Invalid address', 16: 'Invalid account', 17: 'Check address' })[code] }] : [],
  });
}
add('empty-email-does-not-call-service', { fields: { EC1_2_other: null } },
  [{ script: { entity: '1652541995', kind: 'ValidationCode' } }], { writes: [] });

export default cases;
