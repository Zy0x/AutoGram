#!/usr/bin/env node
/**
 * Entry: node remote/run.mjs
 * Or:    double-click 2-Start-Remote-Dan-Suite.cmd
 */
import { main } from './test_modules/test_runner.mjs';

main().catch((e) => {
  console.error(e);
  process.exit(3);
});
