import { nodeIo } from '../io/node-io.js';
import { run } from './run.js';

// ビルド時に tsup の define で package.json の version を埋める
declare const __JEV_VERSION__: string;

process.exitCode = await run(process.argv.slice(2), { io: nodeIo, version: __JEV_VERSION__ });
