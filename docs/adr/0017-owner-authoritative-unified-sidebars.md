# ADR 0017: Owner-authoritative unified sidebars

Status: accepted, 2026-09-08

The unified sidebar is a projection of each desktop's existing native sidebar.
Separate local classification would drift from the very devices it is meant to
control. Native display IDs, membership, pinned state and order are authoritative.

Use a bounded native renderer adapter to read the live model and invoke existing
native sidebar actions. A normalized protocol carries data and a small explicit
action set over existing loopback and signed peer boundaries. A source revision
and readback protect against stale operations. The UI never writes native files,
registers remote native drag IDs, or records alternative membership.

This introduces a version-sensitive native adapter, confined to one boundary.
Unsupported shapes fail closed and show unavailable state. It avoids a second
persistent classification database and does not relax any safety invariant.
