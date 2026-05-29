import { createApp } from './app.js';
import { config, describeMode } from '../config.js';

async function main(): Promise<void> {
  const app = await createApp();
  app.listen(config.port, () => {
    console.log(`\n  Company Brain running`);
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
