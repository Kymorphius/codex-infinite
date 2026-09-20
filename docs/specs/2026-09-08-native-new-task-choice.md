# Preserve native Chat / Work choice when starting project tasks

The project search alias fallback used a raw home-route message. This bypasses native new-task initialization, including resetting the current sidebar conversation and preparing the composer. Replace that fallback with the full native start action. Existing mounted project buttons continue to invoke their exact native button. Ordinary native buttons and mode preferences are never rewritten or intercepted.

The adapter reads the native sidebar new-task component's scoped runtime and resolves one loaded native start export by its complete initialization contract. It fails closed when native structure is unavailable or ambiguous; never substitute a raw route or send a prompt. The start receives only activeProject identity and does not force Chat or Work. Native owns all draft lifecycle and rendering.

Verification: reproduce raw-route behavior; full native initialization must show both Chat and Work. Tests cover loaded native action resolution, project identity forwarding, unavailable/ambiguous adapter rejection, and no route-only fallback. Run full checks and tests.

## Validation evidence
Mac native runtime: full project start shows visible 聊天 and 工作 controls. Returning to a conversation and clicking the untouched native 新聊天 button also shows both controls. Full checks and all 498 tests pass. Windows deployment was unavailable because SSH to the existing device endpoint timed out; no Windows completion is claimed.

## Screenshot correction
The previous existence/bounds check did not establish that controls were unobstructed. User screenshots reveal the fixed conversation tab bar covers the native composer-mode group. On home pages with that group, place the owned tab bar eight pixels below it when horizontal bounds overlap. Keep the native mode group untouched and restore tab top on conversation pages. Validate elementFromPoint at both button centers and real pointer selection of Work, including its composer and project picker; existence alone is insufficient.

Confirmed live after screenshot fix: tab top 56px, both mode-button centers hit their native buttons (previously both were blocked). A real pointer click on 工作 changes native aria-pressed to true and renders the 使用 ChatGPT Work composer plus visible 选择项目 control. Screenshot inspected at /tmp/composer-layout-verified.png. Desktop injection version bumped with tab module so the running page loads the layout fix without app restart.

## Final layout requested by user
Keep console tabs at top 5px on all pages. Reserve a fixed 44px row inside the visible native main surface and shift its direct fixed header to 44px. This moves both the native composer-mode selector and page content downward while keeping the bottom constrained to the viewport. Apply presentation attributes/CSS only; no native child movement. Remove attributes when the native surface changes or the injection is disposed. Supersedes the temporary tab relocation below the mode selector.

Spacing refinement: reduce the reserved row from 44px to 36px (and match the native header/navigation offsets) to tighten the visible gap while keeping tabs fixed at 5px.
