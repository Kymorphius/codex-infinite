import test from "node:test";
import assert from "node:assert/strict";
import { messageDeliveryMode } from "../public/features/sessions/remote-conversation.js";

test("active conversations preserve an explicit queue or steer choice", () => {
  assert.equal(messageDeliveryMode("turn-1", "steer"), "steer");
  assert.equal(messageDeliveryMode("turn-1", "queue"), "queue");
  assert.equal(messageDeliveryMode(null, "queue"), "new-turn");
  assert.equal(messageDeliveryMode("turn-1", "invalid"), "new-turn");
});
