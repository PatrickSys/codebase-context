#!/usr/bin/env node

import { runReviewCli } from './review-cli.js';

runReviewCli(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
