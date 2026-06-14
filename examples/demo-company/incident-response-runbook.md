# Incident Response Runbook — Larkspur Financial

Owner: Engineering (On-call lead: Wei Zhang)
Last reviewed: 2026-05-20

## Severity
- **SEV1**: customer money movement is down or incorrect. Page immediately.
- **SEV2**: degraded but funds are safe. Respond within 30 minutes.
- **SEV3**: minor, no customer impact. Next business day.

## Procedure (how an incident is handled)
1. The on-call engineer acknowledges the page and declares severity.
2. Open an incident channel; assign an incident commander.
3. Mitigate first (stop the bleeding), diagnose second.
4. For any SEV1 touching payments, notify Treasury and Compliance within 15 minutes.
5. After resolution, write a blameless postmortem within 3 business days.

## Rules
- A SEV1 on payments that is not escalated to Compliance within 15 minutes is a process failure and must be flagged.
- Never push a hotfix to the payments service without a second engineer's review, even during an incident.
