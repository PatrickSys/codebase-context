import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const reportPath = process.argv[2] || join(process.env.ROOT || '/tmp/contextbench-five-lane-score', 'publishable-summary.json');
const report = JSON.parse(readFileSync(reportPath, 'utf8'));

const compact = {
  publicationStatus: report.publicationStatus,
  validationStatus: report.biasAudit?.status || null,
  scope: report.scope,
  qualityTable: report.qualityTable,
  costTable: report.costTable,
  tokenTable: report.tokenTable,
  reliabilityTable: report.reliabilityTable,
  limitations: report.limitations,
};

console.log('CONTEXTBENCH_PUBLISHABLE_COMPACT_JSON_START');
console.log(JSON.stringify(compact, null, 2));
console.log('CONTEXTBENCH_PUBLISHABLE_COMPACT_JSON_END');
if (report.biasAudit?.status !== 'pass') process.exitCode = 1;
