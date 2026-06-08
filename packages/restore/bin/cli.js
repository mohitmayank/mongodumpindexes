#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { program } from 'commander';
import { restoreIndexes } from 'mongo-indexes-core';

program
  .name('mongorestoreindexes')
  .description('Restore MongoDB index definitions from a JSON file.')
  .argument('<uri>', 'MongoDB URI including the database, e.g. mongodb://localhost:27017/mydb')
  .argument('<file>', 'input JSON file produced by mongodumpindexes')
  .option('-k, --keep-indexes', 'keep existing indexes (do not drop before recreating)')
  .option('-n, --dry-run', 'print intended operations without modifying the database')
  .option('-c, --collection <name...>', 'restrict to specific collection name(s)')
  .action(async (uri, file, options) => {
    let data;
    try {
      data = JSON.parse(await readFile(file, 'utf8'));
    } catch (err) {
      console.error(`Error reading ${file}: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    if (!Array.isArray(data)) {
      console.error(`Error: ${file} must contain a JSON array of { collection, indexes }.`);
      process.exitCode = 1;
      return;
    }

    try {
      const summary = await restoreIndexes(uri, data, {
        keepIndexes: options.keepIndexes,
        dryRun: options.dryRun,
        collection: options.collection,
      });
      console.log(
        `ensured ${summary.created}, dropped ${summary.dropped}, failed ${summary.failed.length}`,
      );
      for (const f of summary.failed) {
        console.error(`  failed ${f.collection}:${f.name} -> ${f.error}`);
      }
      if (summary.failed.length > 0) process.exitCode = 2;
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);
