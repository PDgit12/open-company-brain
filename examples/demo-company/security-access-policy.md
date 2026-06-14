# Security & Access Policy — Larkspur Financial

Owner: Security (CISO: Marcus Bell)
Last reviewed: 2026-05-10

## Access
- Production data access is **least-privilege** and reviewed quarterly.
- Access to the payments database requires CISO approval and is time-boxed to 90 days.
- All access grants are logged with who granted, who received, and the expiry.

## Rules
- No shared logins. Every action must trace to one named person.
- Customer PII is never copied to a laptop or a personal account.
- A standing (non-expiring) grant to production payments data is a violation and must be flagged.

## Procedure (requesting access)
1. Open an access request naming the system, the reason, and the duration.
2. The system owner and (for payments) the CISO approve.
3. Access auto-expires at the end of the window; renewal requires a fresh request.
