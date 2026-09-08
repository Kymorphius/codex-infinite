# Copy project path from the project context menu

## Behavior

All filesystem-backed sidebar project entry points expose “复制项目路径”: native
local project rows (including custom sections), remote device projects, new
projects, and project search results. Copy all exact project roots, deduplicated in order and separated by newlines, to the
local clipboard without platform conversion, quoting, or network requests. Cached
remote paths remain copyable offline. Multi-root projects also offer individual
path choices. Projects without roots offer a clearly labeled project ID instead.
Never substitute a task's cwd or a display name for a project root.

The clipboard API has a temporary textarea fallback. Success displays
“项目路径已复制”; failure displays “复制失败，请重试”. Temporary elements are always
removed. Existing remote project transfer and conversation ID actions retain their
behavior. ChatGPT projects expose “复制项目链接” and “复制项目 ID”, using the
verified native gizmo ID/short_url and the desktop project URL route.

## Integration boundaries

The first implementation only changed the console-owned remote project menu,
omitting ordinary local project rows. Local project menus are system native menus,
and the desktop's electronBridge is frozen. Neither this bridge nor React props or
children may be mutated.

A contextmenu capture listener resolves the exact native project row through its
stable project ID and a bounded read of the owning React group's rootPaths. It
reads the native menu provider and its formatMessage context, invokes the existing
onBeforeOpen/getItems lifecycle, preserves translated labels, submenus, enabled
flags and original callbacks, and prepends our unique copy action. The unchanged
showContextMenu API displays the combined native menu. Only a selected enabled
original action invokes its original callback; our action only writes clipboard.
Unsupported native rows fall through to their original handler.

New-project and search-result rows use a copy-only native menu. The normalized
project search catalog supplies sourceDirectories derived solely from explicit
project roots; the single-root sourceDirectory field remains for compatibility. Remote project rows retain their console-owned menu. Installation
is idempotent, disposal removes the listener and invalidates pending results, and
no persistent native project state is modified.

## Validation

Execute generated code with a frozen bridge and DOM doubles to exercise the actual
capture → native menu request → selection flow. Cover Windows/POSIX exact paths,
offline remote roots, unavailable roots, original action preservation, submenus,
unrelated menu pass-through, lifecycle cleanup, and clipboard fallback outcomes.
Run `npm run check` and `npm test`; run focused tests on Windows. After deployment,
check both desktop main documents for installed adapter version/readiness and
verify the existing native project/menu/formatting contracts by read-only runtime
inspection. Runtime readiness is not a claim of manual native menu click testing.

## All-project copy coverage (user correction)

Do not disable copying merely because a project has several roots. Retain all
normalized explicit roots. “复制项目路径” copies every root in source order, one
path per line, deduplicated; multi-root menus also offer individual paths. Project
transfer continues to require a single root and is not relaxed. Native local,
new-project, search, and remote device project entries share these semantics.
Cloud projects without a filesystem root must expose a distinctly labeled copy
of their real project address or ID, never a fabricated filesystem path.
