import { createApp } from './app.js';
import { config, describeMode } from '../config.js';
import { logger } from '../observability/logger.js';

// Defense in depth: a stray async error anywhere must not take the server down.
// Route errors are handled by the Express error middleware; this is the backstop.
process.on('unhandledRejection', (reason) => {
  logger.error('unhandled_rejection', { reason: reason instanceof Error ? reason.message : String(reason) });
});

async function main(): Promise<void> {
  const app = await createApp();
  app.listen(config.port, () => {
    console.log(`\n  Comb running`);
    console.log(`  ▸ http://localhost:${config.port}`);
    console.log(`  ▸ mode: ${describeMode()}`);
    if (config.memoryMode === 'mock') {
      console.log(`  ▸ (mock mode — add LANGBASE_API_KEY to .env to go live)\n`);
    } else {
      console.log('');
    }
  });
}

main().catch((err: unknown) => {
  console.error('✗ Failed to start:', err);
  process.exit(1);
});
