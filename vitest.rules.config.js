import { defineConfig } from 'vitest/config';

// Security-rules tests. They need the Firestore emulator: run `npm run test:rules`.
export default defineConfig({
  test: { environment: 'node', include: ['tests-rules/**/*.test.js'], fileParallelism: false },
});
