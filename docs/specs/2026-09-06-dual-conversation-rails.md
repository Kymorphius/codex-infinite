# Dual conversation navigation rails

Move the existing native per-user-message rail to the right edge of the reading
area, before the output/source column when present. Preserve native buttons,
click handlers, hover previews and annotation decorations; reposition via owned
host attributes/CSS only, never reparent React DOM.

Add an owned left rail with one tick per stable conversation turn UUID. Multiple
native user-message ticks in one turn produce one left tick. Only explicit
turn:UUID anchors count; native tail/context placeholders are not turns. Clicking it reveals
the same native turn and selects that turn in the annotation editor. Use the
existing native item preview readers for prompt/response excerpts (deduplicate
multiple messages within a turn), and mounted turn text when the native rail is
absent on short threads. Request native historical preview loading only on hover,
using the native preview callback. Explicitly show unavailable/loading states.
Render excerpts as text; never execute content or send model requests.

Left hover/focus shows native-style summary and, when nonempty, the same turn's
annotation as a matching card directly underneath. Purple ticks denote notes;
current-turn styling uses the annotation reading-position selector to choose
exactly one turn, falling back to one native current marker. Hover styling stays
subtler and never marks an additional turn current.
Keep stable focus while snapshots update. Read saved notes and pending drafts
through the annotation UI's existing view, without independent persistence.

Both rails disappear in dashboard/no-conversation state and clean up on reinjection.
Bound and scroll long rails; keep cards within the viewport. Reserve the native
right output column, preserving the accepted annotation editor and native hover
card behavior. Tests cover turn grouping, safe summary extraction, right placement,
left jump/selection, note cards, current styling and cleanup. Run full check/tests
and deploy narrowly to both own consoles; verify actual rail positions/counts.

Turn tick strokes are 12px wide (18px when current, 14px when hovered), retaining the 36px
click target and remaining more prominent than native resting message ticks.

Display a native-like overview with 10px tick spacing and up to 60 visible ticks,
further bounded by 70 percent of the viewport height. Short conversations display
all ticks without padding or fading. For longer conversations keep this capacity
constant and slide the visible range only when the current turn approaches its
edge. New ticks enter one end while the other end fades away; fade only edges
with more hidden turns, so the absolute first and last ticks remain fully visible.
Do not center the current tick or narrow the overview to a few neighboring turns.
Every turn remains reachable by scrolling the conversation, wheel stepping or
clicking a visible tick. Preserve both summary cards and annotation behavior.
