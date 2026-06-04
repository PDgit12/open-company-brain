/**
 * Demo seed — a tiny, domain-neutral knowledge set so a fresh brain isn't empty.
 *
 * The framework is universal: in real use you feed it YOUR data via ingest
 * (paste / upload / a workflow webhook). This handful of generic notes exists
 * only so the dashboard and the zero-credential mock mode have something to
 * retrieve, cite, and fan agents out over on first run. It is NOT a domain model
 * — it's example content, and you delete or replace it the moment you connect
 * real data.
 *
 * Two access scopes are represented so the governance story is visible out of the
 * box: `default-team` (broadly visible) and `leadership` (restricted).
 */

import { buildDocuments } from '../brain/ingest.js';
import type { MemoryDocument } from '../brain/documents.js';

interface DemoNote {
  source: string;
  access: string;
  content: string;
}

const DEMO_NOTES: DemoNote[] = [
  {
    source: 'project-notes',
    access: 'default-team',
    content:
      'Project Atlas kickoff: migrating the billing service to the new platform. ' +
      'Open action: finalize the data migration plan by Friday.',
  },
  {
    source: 'crm-export',
    access: 'default-team',
    content:
      'Northwind renewed their annual subscription. ' +
      'Follow-up: schedule a product roadmap review next quarter.',
  },
  {
    source: 'support',
    access: 'default-team',
    content:
      'Support retro: the API latency spike was caused by a missing database index. ' +
      'Fix is deploying this week; monitor p95 afterwards.',
  },
  {
    source: 'handbook',
    access: 'default-team',
    content:
      'Engineering onboarding: new hires request staging access and read the ' +
      'deployment runbook on day one.',
  },
  {
    source: 'board',
    access: 'leadership',
    content:
      'Confidential mandate: the NorthBridge acquisition targets a Q4 close. ' +
      'Sensitive figures enclosed — do not distribute beyond leadership.',
  },
];

/** Build the demo notes into memory documents (same path real ingestion uses). */
export function demoDocuments(): MemoryDocument[] {
  return DEMO_NOTES.flatMap((n) =>
    buildDocuments({ format: 'text', content: n.content, source: n.source, access: n.access }),
  );
}
