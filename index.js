// -----------------------------------------------------------------------------
// Entry point: SDK wiring only. PollyApp (src/app.js) registers its handlers
// BEFORE connect(); /data holds the monthly count, the pause and the refused
// keys (src/store.js); Amazon Polly is reached through src/polly.js.
//
// Environment variables provided by the Gladys supervisor, read by the SDK:
// GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { PollyApp } from './src/app.js';
import { createPolly } from './src/polly.js';
import { FileStore } from './src/store.js';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const gladys = new GladysIntegration();
const app = new PollyApp({
  gladys,
  logger,
  store: new FileStore(),
  createPolly,
  userAgent: `gladys-amazon-polly/${version} (+https://github.com/LM1LC3N7/gladys-amazon-polly)`,
});

gladys.handleShutdown(() => app.stop());

logger.info('Starting the Amazon Polly integration...');
app.start().catch((err) => {
  logger.error(`Initial connection failed (${err?.name ?? 'Error'})`);
  process.exit(1);
});
