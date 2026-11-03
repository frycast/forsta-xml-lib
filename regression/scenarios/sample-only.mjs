const survey = 'surveys/p177291954851.xml';
const cases = [];
// Row = previous state, column = new query value. DONE is absorbing; SCREEN
// may become DONE. Arbitrary codes do not automatically establish completion.
const inputs = [null, 'DONE', 'SCREEN', 'OTHER'];
const transitions = [
  [null, 'DONE', 'SCREEN', 'OTHER'],
  ['DONE', 'DONE', 'DONE', 'DONE'],
  ['SCREEN', 'DONE', 'SCREEN', 'SCREEN'],
  ['OTHER', 'DONE', 'SCREEN', 'OTHER'],
];
for (const [row, current] of inputs.entries()) {
  for (const [col, incoming] of inputs.entries()) {
    const after = transitions[row][col];
    const visited = after === 'DONE' ? ['1652542308', '1652542307']
      : after === 'SCREEN' ? ['1652542308', '1652542310', '1652542309']
      : ['1652542308', '1652542310'];
    cases.push({ id: `sample-only/scode/${current}/${incoming}`, survey,
      given: { fields: { scode: current, completion_scode: 'DONE', screened_scode: 'SCREEN' }, query: { scode: incoming } },
      steps: [{ script: { entity: '1652542302', kind: 'ScriptCode' } },
        { route: { entity: '1652542308' } }, { route: { entity: '1652542310' } }],
      expect: { fields: { scode: after }, visited,
        halt: after === 'DONE' ? { kind: 'stop', entity: '1652542307', stopType: 'Complete', extendedStatus: '13' }
          : after === 'SCREEN' ? { kind: 'stop', entity: '1652542309', stopType: 'Screened', extendedStatus: '14' } : null },
    });
  }
}
// GetBaseURL is defined in the XML, so use its real script, not a stub.
cases.push({ id: 'sample-only/redirect-preserves-sid', survey,
  given: { fields: { sid: 'synthetic-123', client_url: null }, respondent: { ExternalSurveyLink: 'https://client.example.invalid/survey?source=fixture' } },
  steps: [{ script: { entity: '1652542312', kind: 'ScriptCode' } }, { script: { entity: '1652542314', kind: 'ScriptCode' } }],
  expect: { fields: { client_url: 'https://client.example.invalid/survey?source=fixture&sid=synthetic-123' },
    effects: [{ api: 'Redirect', args: ['https://client.example.invalid/survey?source=fixture&sid=synthetic-123', true] }], halt: { kind: 'redirect' } },
});
export default cases;
