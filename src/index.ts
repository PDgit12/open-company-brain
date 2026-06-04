/**
 * Public library surface — `import { Brain, createApp } from 'open-company-brain'`.
 *
 * Two ways to use the framework:
 *   1. Embed it. Construct a `Brain`, call `ingest` / `ask` / `draft` directly
 *      inside your own app — no server required.
 *   2. Run it. `createApp()` returns the full Express app (dashboard + REST API).
 *
 * Everything re-exported here is part of the supported, semver-tracked surface.
 * Internals (memory/generator backends, prompt builders) stay importable by deep
 * path but are not guaranteed stable.
 */

export { Brain, type BrainAnswer } from './brain/brain.js';
export { createApp, asyncRoute } from './server/app.js';

// Data-in: the universal ingest path (text / CSV / JSON, any shape).
export {
  buildDocuments,
  normalizeSource,
  IngestBodySchema,
  MAX_INGEST_CHARS,
  MAX_INGEST_DOCS,
  type IngestFormat,
  type IngestInput,
} from './brain/ingest.js';
export { type MemoryDocument } from './brain/documents.js';

// Recall layer (bring your own store, or use the factory).
export {
  createMemoryStore,
  type MemoryStore,
  type RetrievedChunk,
  type SourceCount,
} from './brain/memory.js';

// Event-driven fan-out: agents that run automatically on each ingest.
export {
  getReactionAgentStore,
  type ReactionAgent,
  type ReactionAgentInput,
} from './fanout/registry.js';
export {
  runReactions,
  getFanoutResultStore,
  type FanoutResult,
  type IngestEvent,
} from './fanout/engine.js';

// No-code custom agents (define + run a grounded agent from a prompt).
export { getCustomAgentStore, type CustomAgent } from './agents/registry.js';

// Human-approved action layer.
export {
  ActionService,
  type ProposeInput,
} from './actions/service.js';
export type { ProposedAction, ProposeResult } from './actions/types.js';

// Config + mode banner.
export { config, describeMode } from './config.js';
