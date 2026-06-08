#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { program } from 'commander';
import { dumpIndexes } from 'mongo-indexes-core';

program
  .name('mongodumpindexes')
  .description('Dump MongoDB index definitions to a JSON file.')
  .argument('<uri>', 'MongoDB URI including the database, e.g. mongodb://localhost:27017/mydb')
  .argument('<file>', 'output JSON file path')
  .option('-c, --collection <name...>', 'restrict to specific collection name(s)')
  .action(async (uri, file, options) => {
    try {
      const data = await dumpIndexes(uri, { collection: options.collection });
      await writeFile(file, JSON.stringify(data, null, 2) + '\n');
      const indexCount = data.reduce((n, c) => n + c.indexes.length, 0);
      console.log(`Dumped ${data.length} collections (${indexCount} indexes) -> ${file}`);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);
