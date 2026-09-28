# ADR 0043: Device-owned project identity mappings

- Date: 2026-09-28
- Status: accepted

Each device stores its own registered checkout path to a shared project UUID under
its private wrapper home. Native project IDs and histories remain native-owned.
No repository remote URL, machine path similarity, copied credentials, or new
conversation ID defines cross-device identity.

Mappings are advisory discovery metadata, never authorization or evidence that
code, sessions, runtime state or task ownership were transferred. Git synchronization
retains its existing checks. A corrupt mapping store fails closed.

A user-approved link binds a verified preflight to two expected mappings. Nodes
compare before replacing under an exclusive filesystem lock and atomically publish
the new mapping file. The coordinator writes in deterministic endpoint order and
reads both back. The protocol does not promise an atomic cross-device transaction:
an interrupted link may persist at one endpoint. It does not replay writes or undo
confirmed metadata. A new preflight resumes by adopting the existing UUID; competing
different identities require explicit unlinking. Unlink affects one device only.

This avoids an always-online central project registry, allows any configured device
to coordinate the next operation, and leaves a future project creation/handoff
protocol free to use durable operation receipts for stronger ownership guarantees.
