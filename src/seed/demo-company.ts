/**
 * A realistic fictional-company corpus for hands-on testing — "Northwind
 * Robotics". Loaded into the REAL backend via `comb demo-data` (NOT the mock
 * seed; this is for trying the pipeline at slightly larger scale with varied
 * formats: markdown, csv, json, plain text). Replace with your own data the
 * moment you have it — this exists only so you can demo without your own docs.
 */

export interface DemoDoc {
  source: string;
  format: 'text' | 'csv' | 'json';
  content: string;
}

export const DEMO_COMPANY: DemoDoc[] = [
  {
    source: 'handbook',
    format: 'text',
    content: `# Northwind Robotics — Employee Handbook

## Company
Northwind Robotics builds warehouse automation robots. Founded 2021, HQ in Austin, ~180 employees across Engineering, Sales, Support, Operations, and Finance.

## Working hours
Core hours are 10am–4pm local. Outside that, work when you're productive. Fully remote-friendly; the Austin office is optional.

## Time off
Unlimited PTO with a 15-day minimum expectation per year. Submit requests in the HR portal at least 5 business days ahead for anything over 3 days. Manager approval required.

## Equipment
New hires get a laptop and a $500 home-office stipend. Hardware over $1,000 needs IT director approval.

## Code of conduct
We are direct and kind. Harassment, discrimination, and retaliation are grounds for termination. Report concerns to People Ops or the anonymous ethics line.`,
  },
  {
    source: 'refund-policy',
    format: 'text',
    content: `# Refund & Return Policy (Customers)

Standard robots may be returned within 30 days of delivery for a full refund, minus a 10% restocking fee, if returned in original condition.

Custom-configured units are non-refundable once assembly begins.

Refunds over $10,000 require Finance Director approval. Refunds over $50,000 require VP Finance approval AND a written reason logged in the deal record.

Damaged-on-arrival units: full refund or free replacement, no restocking fee, photo evidence required within 7 days.

Goodwill credits up to $2,000 may be issued by any Support lead without further approval.`,
  },
  {
    source: 'pricing-exceptions',
    format: 'text',
    content: `# Pricing Exception Process

List price holds unless an exception is approved. Discounts:
- Up to 10%: any Account Executive, no approval.
- 10–20%: Sales Manager approval.
- 20–30%: VP Sales approval + margin review by Finance.
- Over 30%: CEO approval, rare, only for strategic logos.

Multi-year prepay earns an automatic 8% in addition to the above.

All exceptions must be recorded in the CRM opportunity with the approver's name and the business justification before the quote is sent.`,
  },
  {
    source: 'incident-response',
    format: 'text',
    content: `# Engineering Incident Response

## Severity
- SEV1: customer robots down / data loss / security breach. Page on-call immediately.
- SEV2: degraded performance, no workaround. Respond within 1 hour.
- SEV3: minor, workaround exists. Next business day.

## Process
1. Declare in #incidents with severity and a one-line summary.
2. On-call becomes Incident Commander until handed off.
3. SEV1/SEV2: open a shared doc, post updates every 30 minutes.
4. Mitigate first, root-cause later. Roll back before you debug forward.
5. Within 48h of resolution: a blameless postmortem with timeline, root cause, and action items.

Never push a fix to production during a SEV1 without a second engineer's review.`,
  },
  {
    source: 'security-faq',
    format: 'text',
    content: `# Security FAQ (for sales & support)

Data residency: customer telemetry is stored in the customer's chosen region (US, EU, or AP). We never move it across regions.

Encryption: data is encrypted in transit (TLS 1.3) and at rest (AES-256).

Access: customer data is access-scoped; engineers get time-boxed, audited access only during an active support ticket.

Certifications: SOC 2 Type II (current), ISO 27001 (in progress, expected Q4). We are NOT HIPAA-certified — do not claim HIPAA compliance.

Sub-processors: AWS (hosting), Datadog (monitoring), Stripe (billing). The full list is in the Trust Center.`,
  },
  {
    source: 'onboarding',
    format: 'text',
    content: `# Engineering Onboarding

Week 1: laptop setup, access requests, read the architecture docs, ship a one-line PR by Friday.
Week 2: pair with your onboarding buddy, take a small bug from the backlog end to end.
Week 3: join the on-call shadow rotation (observe only).
Week 4: own a small feature; first solo on-call shadow.

Target: first meaningful feature merged by end of week 4. If onboarding is taking longer than 4 weeks, flag it to your manager — it usually means our docs are stale or access is blocked.`,
  },
  {
    source: 'eng-standards',
    format: 'text',
    content: `# Engineering Standards

Language: TypeScript (strict) for services, Rust for robot firmware. No new Python services.
Reviews: every PR needs one approval; firmware changes need two.
Tests: new code ships with tests; we gate merges on green CI.
Secrets: never in code or env files in the repo. Use the secrets manager.
Deploys: trunk-based, feature-flagged, deploy multiple times a day. No Friday-afternoon deploys to robot fleets.
Deprecated: the old "Atlas" scheduling framework is deprecated — do not build on it; use "Orchestra".`,
  },
  {
    source: 'oncall',
    format: 'text',
    content: `# On-Call Policy

Rotation is weekly, one primary and one secondary per team. Handoff is Monday 10am with a written summary of open issues.

Primary acknowledges pages within 15 minutes (SEV1) or 1 hour (SEV2). If primary doesn't ack within the window, it escalates to secondary, then to the EM.

Comp: on-call weeks earn a stipend and a comp day. You are not expected to do feature work during your on-call week.

You may decline on-call only with manager sign-off and a swap arranged.`,
  },
  {
    source: 'leave-policy',
    format: 'text',
    content: `# Parental & Medical Leave

Parental leave: 16 weeks fully paid for the primary caregiver, 8 weeks for the secondary, within the first year. Can be taken in up to two blocks.

Medical leave: up to 12 weeks, paid per the short-term disability plan. A doctor's note is required after 5 consecutive days.

Bereavement: 5 days paid for immediate family, 2 days for extended.

All leave is job-protected. Coordinate timing with your manager and People Ops at least 30 days ahead when foreseeable.`,
  },
  {
    source: 'expenses',
    format: 'csv',
    content: `category,limit_usd,approval,notes
meals_travel,75,none,per day with receipts
software,200,IT for over 200,annual per-seat over 200 needs IT
hardware,1000,IT director for over 1000,
client_entertainment,500,manager,itemized receipt required
conference,2500,manager + finance,includes travel and ticket
home_office,500,none,one-time stipend for new hires`,
  },
  {
    source: 'vendors',
    format: 'csv',
    content: `vendor,service,owner,renewal,annual_usd
AWS,hosting,Platform,2026-09-01,420000
Datadog,monitoring,SRE,2026-07-15,68000
Stripe,billing,Finance,rolling,variable
Greenhouse,recruiting,People Ops,2026-11-01,24000
Figma,design,Design,2026-08-01,18000`,
  },
  {
    source: 'customers',
    format: 'json',
    content: JSON.stringify(
      {
        accounts: [
          { name: 'Vertex Logistics', tier: 'enterprise', robots: 240, renewal: '2026-10-01', csm: 'Dana Reyes' },
          { name: 'Helix Foods', tier: 'mid-market', robots: 60, renewal: '2026-08-15', csm: 'Sam Okoye' },
          { name: 'Aerie Distribution', tier: 'enterprise', robots: 410, renewal: '2027-01-20', csm: 'Dana Reyes' },
          { name: 'Polar Cold Chain', tier: 'mid-market', robots: 35, renewal: '2026-07-30', csm: 'Lee Park' },
        ],
      },
      null,
      2,
    ),
  },
];
