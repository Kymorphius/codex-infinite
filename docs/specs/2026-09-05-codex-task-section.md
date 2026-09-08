# Codex initiated task section

Add an automatic codex委派 section (order 7) alongside review/running sections.
Latest initiating input controls membership, not the latest assistant reply and
not the session's original creator. Codex-origin tasks appear only in codex among
these automatic sections, regardless of completion/read state; original project
membership remains unchanged. A later real user input restores normal active or
completed-unread filtering. Archived tasks remain excluded. No drag/drop or native
state writes. Reuse native section style, counts, collapse, and navigation.

Extract normalized latestInputSource from existing bounded session parsing. Use
native codex_app create_thread/send_message_to_thread received tool outputs with
valid full codex_delegation envelopes and UUID source_thread_id; support legacy
user-input envelopes. Ordinary tool outputs, outgoing calls, assistant replies,
quoted marker substrings, and environment-only input must not change ownership.
Do not classify from generic session originator=codex_work_desktop. Unknown origin
keeps existing behavior. This is presentation metadata, never authorization.

Validate input transitions, modern and legacy formats, transport/quoted markers,
Codex exclusivity across statuses/read state, native sibling count and navigation.
Run full check/tests and deploy to Mac and Windows console services; verify live
sections and existing project rows without marking conversations read.
