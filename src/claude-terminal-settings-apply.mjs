import { claudeSettingsCommands } from './claude-terminal-settings.mjs';

const PASTE_START = '\x1b[200~', PASTE_END = '\x1b[201~';
const timer = (fn, ms) => { const handle = setTimeout(fn, ms); handle.unref?.(); return handle; };

// Applies a model / effort / ultracode choice to a running managed Claude by typing /model and
// /effort into its PTY, one command at a time and only while it is safe (see the spec): Claude
// registered idle, the input line holds nothing unsubmitted, and no input for `quietMs`.
// Otherwise the change waits; each conversation keeps only its latest target. `known` is what
// the running Claude is believed to use (launch flags, then each typed command). `inputLine` reads
// the runtime's current input-line state synchronously (TerminalService.inputLine).
export function createClaudeSettingsApplier({ inspect, write, inputLine, now = Date.now, schedule = timer, cancel = clearTimeout,
  delay = ms => new Promise(resolve => setTimeout(resolve, ms)), pollMs = 1000, quietMs = 1500, submitDelayMs = 150, settleMs = 10000 }) {
  const states = new Map();
  const choice = settings => ({ model: settings.model, effort: settings.effort, ultracode: settings.ultracode === true });
  function drop(id) { const state = states.get(id); if (state?.timer) cancel(state.timer); states.delete(id); }
  function arm(id, state, ms = pollMs) {
    if (state.timer || state.working || states.get(id) !== state) return;
    state.timer = schedule(() => { state.timer = null; void run(id, state); }, ms);
  }
  function queue(id, state, settings) {
    state.target = choice(settings);
    if (!claudeSettingsCommands(state.known, state.target).length) state.target = null;
    else arm(id, state, 0);
  }
  // The line as inspected, still unchanged now (no input arrived while inspect read the registration).
  async function verdict(id, state) {
    let view = null;
    try { view = await inspect(id); } catch { return 'wait'; }
    if (!view || view.runtimeId !== state.runtimeId) return 'gone';
    const line = view.inputLine || { dirty: true, at: now(), seq: -1 };
    const ready = view.claudeStatus === 'idle' && !line.dirty && now() - line.at >= quietMs && inputLine(state.runtimeId).seq === line.seq;
    return ready ? 'ready' : 'wait';
  }
  // One command per run; the next waits for the quiet period again, so Claude has handled this one.
  async function run(id, state) {
    const mine = () => states.get(id) === state, remaining = () => state.target ? claudeSettingsCommands(state.known, state.target) : [];
    if (!mine() || !state.target) return;
    let next = pollMs;
    state.working = true;
    try {
      const step = remaining()[0], safe = step ? await verdict(id, state) : 'wait';
      if (!mine()) return;
      if (safe === 'gone') { drop(id); return; }
      if (safe === 'ready') {
        const pasted = write(state.runtimeId, PASTE_START + step.text + PASTE_END);
        await delay(submitDelayMs);
        if (!mine()) return;
        // Someone typed during the wait: never press Enter on a line they are editing. The pasted
        // text stays for them to see; the step is retried once the line is clean again.
        if (inputLine(state.runtimeId).seq === pasted.seq) {
          write(state.runtimeId, '\r'); state.known = step.settings; state.appliedAt = now(); next = quietMs;
        }
      }
      // A newer choice made meanwhile is what remains to be typed.
      if (!remaining().length) state.target = null;
    } catch { if (mine()) drop(id); return; } finally { state.working = false; }
    if (state.target) arm(id, state, next);
  }
  return {
    // A new runtime: launch flags set model and effort; ultracode never survives a launch.
    launched(id, runtimeId, settings) {
      drop(id);
      const state = { runtimeId, known: settings ? { ...choice(settings), ultracode: false } : null, target: null, timer: null, working: false, appliedAt: 0 };
      states.set(id, state);
      if (settings?.ultracode) queue(id, state, settings);
    },
    // The picker changed the stored choice; returns whether a running Claude will receive it.
    request(id, settings) { const state = states.get(id); if (!state) return false; queue(id, state, settings); return true; },
    // The person changed it inside Claude: that is now current, and any older target is void.
    observed(id, settings) { const state = states.get(id); if (!state) return; state.known = choice(settings); state.target = null; },
    stopped: drop,
    pending: id => Boolean(states.get(id)?.target),
    // Transcript read-back waits while a change is queued, being typed, or just typed (its records may lag).
    settling(id) { const state = states.get(id); return Boolean(state && (state.target || state.working || now() - state.appliedAt < settleMs)); },
  };
}
