# 0018: Discover Skill metadata independently from copy packages

Accepted: 2026-09-08.

A valid installed Skill can carry more reference data than a copy budget allows.
Discovery therefore reads only its entry document; unknown package measurements
and hashes remain null. Content equality is determined only during copying.
This avoids making list visibility depend on export eligibility.

Raise the bounded copy budget from 128 files / 2 MiB to 2048 files / 32 MiB,
with 64 MiB encoded transport limits. This admits the observed 149-file design
library while retaining finite memory and request bounds. Existing authentication,
path validation, link rejection and optimistic replacement checks are unchanged.
