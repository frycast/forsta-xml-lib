const cases = [];
const fields = { incentive_amount: '10', survey_name: 'Synthetic survey', src_job_id: 'TEST', recordid: 'fixture-record' };
const award = { api: 'SetPanelistCredit', args: [10, 'Synthetic survey (TEST) completed, awarded 10 dollars.', -1, 'fixture-record'] };

for (const [label, survey, table] of [
  ['lulu', 'surveys/p624569876868.xml', [[13, 0, true], [32, 0, true], [14, 0, false], [0, 1, false]]],
  ['omnibus', 'surveys/p312541195228.xml', [[13, 0, true], [32, 0, false], [0, 0, false], [0, 1, true], [14, 2, true], [0, null, false], [0, -1, false]]],
]) {
  for (const [extendedStatus, sections, eligible] of table) {
    for (const dummy of ['N', 'Y', null]) {
      for (const status of [null, 'complete']) {
        const credit = eligible && dummy === 'N';
        cases.push({ id: `${label}/incentive/${extendedStatus}/${sections}/${dummy}/${status}`, survey,
          given: { fields: { ...fields, dummy_sample: dummy, n_sections: sections }, environment: { extendedStatus, status } },
          steps: [{ script: { entity: '1652542110', kind: 'ScriptCode' } }, { script: { entity: '1652542168', kind: 'ScriptCode' } }],
          expect: { effects: credit ? [award, ...(status === null ? [{ api: 'SetStatus', args: ['Incomplete'] }] : [])] : [],
            environment: { status: credit && status === null ? 'Incomplete' : status }, writes: [] },
        });
      }
    }
  }
  cases.push({ id: `${label}/additional-incentive-disabled`, survey,
    given: { fields: { dummy_sample: 'N', n_sections: 10 }, environment: { extendedStatus: 13 } },
    steps: [{ script: { entity: '1652542228', kind: 'ScriptCode' } }], expect: { writes: [] } });
}
export default cases;
