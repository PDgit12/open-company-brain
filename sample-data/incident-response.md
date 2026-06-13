# Engineering Incident Response

## Severity
- SEV1: customer robots down, data loss, or security breach. Page on-call immediately.
- SEV2: degraded performance, no workaround. Respond within 1 hour.
- SEV3: minor, workaround exists. Next business day.

## Process
1. Declare in #incidents with severity and a one-line summary.
2. On-call becomes Incident Commander until handed off.
3. SEV1/SEV2: open a shared doc, post updates every 30 minutes.
4. Mitigate first, root-cause later. Roll back before debugging forward.
5. Within 48h of resolution: a blameless postmortem with timeline, root cause, action items.

Never push a fix to production during a SEV1 without a second engineer's review.
