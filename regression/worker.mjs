import { readFileSync } from 'node:fs';
import { executeScenario } from './runner.mjs';

const { scenario, survey } = JSON.parse(readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify(executeScenario(scenario, survey)));
