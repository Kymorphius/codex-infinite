import { installNativeProjectChecklist } from './native-project-checklist.mjs';
import { readNativeChecklistHeldTodos } from './native-checklist-held-todos.mjs';
import { readNativeChecklistConversationChoices } from './native-checklist-conversation-choices.mjs';
import { readNativeComposerThreadId } from './native-composer-thread-id.mjs';
import { createChecklistReturnBridge } from './native-checklist-return.mjs';
import { checklistTimeMetadata } from './project-checklist-time.mjs';
import { createChecklistTimePresentation } from './checklist-time-presentation.mjs';
import { createChecklistTaskEditor } from './native-checklist-task-editor.mjs';
import { createChecklistSearch } from './native-checklist-search.mjs';
import { createNativeChecklistThreadStarter, createNativeChecklistNewThreadClaim } from './native-checklist-new-thread-claim.mjs';
import { PROJECT_CHECKLIST_SYNC_BINDING } from './project-checklist-sync-wake.mjs';
import { createNativeHeldImageTools } from './native-held-image-tools.mjs';
import { normalizeChecklistInput } from './project-checklist-input.mjs';
import { assignedChecklistTasksForThread } from './project-checklist-assignment.mjs';
import { createNativeChecklistPasteImages, createNativeChecklistTaskModel } from './native-checklist-unified-task.mjs';
import { createNativeChecklistTaskRow } from './native-checklist-task-row.mjs';
import { createNativeChecklistAssignmentControl } from './native-checklist-assignment-control.mjs';
import { focusNativeChecklistTask, openNativeChecklistReassignPicker, createNativeChecklistReassignController } from './native-checklist-board-jump.mjs';
import { createNativeChecklistTodoMutations } from './native-checklist-todo-mutations.mjs';
import { replaceHeldEditableText } from './held-queue-edit.mjs';
import { createChecklistDeliveryBridge } from './native-checklist-delivery.mjs';
import { nativeChecklistStyles } from './native-checklist-style.mjs';
import { createChecklistConflictView } from './native-checklist-conflicts.mjs';

export function buildNativeProjectChecklistScript() {
  return `${createChecklistConflictView.toString()}\n${nativeChecklistStyles.toString()}\n${createChecklistDeliveryBridge.toString()}\n${focusNativeChecklistTask.toString()}\n${openNativeChecklistReassignPicker.toString()}\n${createNativeChecklistReassignController.toString()}\n${createNativeChecklistTodoMutations.toString()}\n${replaceHeldEditableText.toString()}\n${createNativeChecklistThreadStarter.toString()}\n${createNativeChecklistNewThreadClaim.toString()}\n${createNativeChecklistTaskModel.toString()}\n${createNativeChecklistPasteImages.toString()}\n${createNativeChecklistTaskRow.toString()}\n${createNativeChecklistAssignmentControl.toString()}\n(${installNativeProjectChecklist.toString()})(${readNativeChecklistHeldTodos.toString()},${readNativeChecklistConversationChoices.toString()},${readNativeComposerThreadId.toString()},${createChecklistReturnBridge.toString()},${checklistTimeMetadata.toString()},${createChecklistTimePresentation.toString()},${createChecklistTaskEditor.toString()},${createChecklistSearch.toString()},createNativeChecklistThreadStarter,createNativeChecklistNewThreadClaim,${JSON.stringify(PROJECT_CHECKLIST_SYNC_BINDING)},${normalizeChecklistInput.toString()},${createNativeHeldImageTools.toString()},${assignedChecklistTasksForThread.toString()},createNativeChecklistPasteImages,createNativeChecklistTaskModel);`;
}
