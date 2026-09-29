import { httpError } from './http-utils.mjs';
import { discussionCreateInput, discussionForwardInput, discussionCommentInput, discussionPrepareInput, discussionBeginInput, discussionId, discussionRole } from './discussion-contract.mjs';

const own = (input, keys) => {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !keys.includes(key))) throw httpError(400, '请求内容无效');
  return input;
};

// The one validated operation table. Transports (HTTP, the native page bridge) only decide
// who may call it; they never validate or interpret input themselves.
export function discussionActions(service) {
  return {
    list: async input => { own(input, []); return service.list(); },
    get: async input => service.get({ id: discussionId(own(input, ['id']).id) }),
    'for-conversation': async input => service.forConversation({ conversationId: own(input, ['conversationId']).conversationId }),
    candidates: async input => { own(input, ['conversationId', 'role']); return service.candidates({ conversationId: discussionId(input.conversationId), role: discussionRole(input.role) }); },
    create: async input => service.create(discussionCreateInput(input)),
    prepare: async input => service.prepare(discussionPrepareInput(input)),
    begin: async input => service.begin(discussionBeginInput(input)),
    latest: async input => { own(input, ['id', 'from']); return service.latest({ id: discussionId(input.id), from: discussionRole(input.from) }); },
    comment: async input => service.comment(discussionCommentInput(input)),
    forward: async input => service.forward(discussionForwardInput(input)),
    stop: async input => service.stop({ id: discussionId(own(input, ['id']).id) }),
  };
}
