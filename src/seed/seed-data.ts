/**
 * Synthetic seed data — entirely fictional.
 *
 * No real or personal data appears here. This is what makes the brain
 * demoable with zero credentials and what the tests run against. Replace by
 * pointing DATABASE_URL at your real Postgres; nothing else changes.
 */

import type { BrainSnapshot } from '../domain/types.js';

const ACCESS = 'default-team';
const LEADERSHIP = 'leadership'; // a second scope, to demonstrate access denial
const now = '2026-05-01T00:00:00.000Z';

export const SEED_SNAPSHOT: BrainSnapshot = {
  companies: [
    {
      id: '1',
      name: 'Aerodyne Systems',
      industry: 'Aerospace & Defense',
      partnershipTier: 'Platinum',
      summary: 'Long-standing hiring partner; exploring expansion into ML research funding.',
      access: ACCESS,
      updatedAt: now,
    },
    {
      id: '2',
      name: 'NorthBridge Capital',
      industry: 'Financial Services',
      partnershipTier: 'Gold',
      summary: 'Sponsors the annual fintech case competition; recruits analytics talent.',
      access: ACCESS,
      updatedAt: now,
    },
    {
      id: '3',
      name: 'Helix Biolabs',
      industry: 'Biotech',
      partnershipTier: 'Prospect',
      summary: 'Early conversations about a research collaboration; no formal agreement yet.',
      access: ACCESS,
      updatedAt: now,
    },
    {
      id: '4',
      name: 'Veridian Energy',
      industry: 'Clean Energy',
      partnershipTier: 'Gold',
      summary: 'Funds two sponsored projects; interested in battery materials research.',
      access: ACCESS,
      updatedAt: now,
    },
  ],
  contacts: [
    { id: '1', companyId: '1', name: 'Dana Whitfield', title: 'Director, Partnerships', email: 'dana@example-aerodyne.test', notes: 'Primary sponsor contact. Prefers email.', access: ACCESS, updatedAt: now },
    { id: '2', companyId: '1', name: 'Marcus Lee', title: 'Talent Lead', email: 'marcus@example-aerodyne.test', notes: 'Owns the hiring pipeline.', access: ACCESS, updatedAt: now },
    { id: '3', companyId: '2', name: 'Priya Raman', title: 'VP Talent', email: 'priya@example-northbridge.test', notes: 'Decision-maker for sponsorship renewals.', access: ACCESS, updatedAt: now },
    { id: '4', companyId: '3', name: 'Sam Okafor', title: 'Head of R&D', email: 'sam@example-helix.test', notes: 'Met at the biotech symposium.', access: ACCESS, updatedAt: now },
    { id: '5', companyId: '4', name: 'Dana Whitfield', title: 'Board Advisor', email: 'dana@example-veridian.test', notes: 'Same individual who advises Aerodyne — a real cross-company connection.', access: ACCESS, updatedAt: now },
  ],
  engagements: [
    { id: '1', companyId: '1', kind: 'sponsorship', date: '2026-04-12', summary: 'Renewal call — agreed to continue Platinum tier for another year.', openActions: 'Send updated MOU by May 15.', access: ACCESS, updatedAt: now },
    { id: '2', companyId: '1', kind: 'research-funding', date: '2026-03-02', summary: 'Exploratory meeting on funding an ML research lab.', openActions: 'Connect Dana with the research lead.', access: ACCESS, updatedAt: now },
    { id: '3', companyId: '2', kind: 'event', date: '2026-02-20', summary: 'Hosted a fintech case competition; 120 attendees.', openActions: null, access: ACCESS, updatedAt: now },
    { id: '4', companyId: '4', kind: 'sponsorship', date: '2026-01-15', summary: 'Confirmed funding for two sponsored projects.', openActions: 'Share mid-cycle progress report.', access: ACCESS, updatedAt: now },
    { id: '5', companyId: '3', kind: 'intro', date: '2026-04-28', summary: 'Initial intro call about a possible research collaboration.', openActions: 'Send research capability one-pager.', access: ACCESS, updatedAt: now },
    // Leadership-only: a default-team caller must NOT see this in retrieval.
    { id: '6', companyId: '2', kind: 'confidential', date: '2026-05-02', summary: 'Confidential: NorthBridge exploring a large multi-year mandate; sensitive figures discussed.', openActions: 'Leadership to follow up directly.', access: LEADERSHIP, updatedAt: now },
  ],
  programs: [
    { id: '1', name: 'Talent Pipeline', description: 'Year-round placements for early-career talent.', access: ACCESS, updatedAt: now },
    { id: '2', name: 'Sponsored Projects', description: 'Partners fund and mentor hands-on projects.', access: ACCESS, updatedAt: now },
    { id: '3', name: 'ML Research Initiative', description: 'Industry-funded machine learning research.', access: ACCESS, updatedAt: now },
  ],
  companyPrograms: [
    { companyId: '1', programId: '1' },
    { companyId: '1', programId: '3' },
    { companyId: '4', programId: '2' },
    { companyId: '4', programId: '3' },
    { companyId: '2', programId: '1' },
  ],
};
