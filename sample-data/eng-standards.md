# Engineering Standards

Languages: TypeScript (strict) for services, Rust for robot firmware. No new Python services.
Reviews: every PR needs one approval; firmware changes need two.
Tests: new code ships with tests; merges gate on green CI.
Secrets: never in code or committed env files. Use the secrets manager.
Deploys: trunk-based, feature-flagged, multiple times a day. No Friday-afternoon deploys to robot fleets.
Deprecated: the old "Atlas" scheduling framework is deprecated - do not build on it; use "Orchestra".
