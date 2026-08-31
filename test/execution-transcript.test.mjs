import test from "node:test";
import assert from "node:assert/strict";
import {
  executionDetailBytes,
  limitExecutionEntryDetail,
  MAX_EXECUTION_FIELD_BYTES,
  mergeExecutionResult,
  normalizePeerExecutionDetail,
  projectExecutionCall,
  projectExecutionResult
} from "../src/execution-transcript.mjs";

test("execution calls preserve exact recorded string input", () => {
  const input = "  printf '<secret>'\n\u0000trailing space  ";
  const call = projectExecutionCall({
    type: "custom_tool_call",
    id: "item-1",
    call_id: "call-1",
    name: "exec_command",
    status: "in_progress",
    input
  });

  assert.equal(call.input, input);
  assert.equal(call.callId, "call-1");
  assert.equal(call.inputTruncated, false);
  assert.equal(projectExecutionCall({ type: "reasoning", input: "hidden" }), null);
});

test("execution results retain complete structured output and join their call", () => {
  const value = [{ type: "input_text", text: "line one\nline two" }, { type: "input_image", image_url: "data:image/png;base64,AA==" }];
  const result = projectExecutionResult({ type: "custom_tool_call_output", call_id: "call-1", output: value });
  const merged = mergeExecutionResult(projectExecutionCall({
    type: "custom_tool_call",
    call_id: "call-1",
    name: "exec_command",
    status: "requested",
    input: "pwd"
  }), result);

  assert.equal(result.output, JSON.stringify(value, null, 2));
  assert.equal(merged.output, result.output);
  assert.equal(merged.status, "completed");
  assert.equal(projectExecutionResult({ type: "reasoning", output: "hidden" }), null);
});

test("execution fields and aggregate detail use explicit UTF-8 truncation", () => {
  const oversized = "你".repeat(Math.ceil(MAX_EXECUTION_FIELD_BYTES / 3) + 20);
  const call = projectExecutionCall({ type: "function_call", call_id: "call-1", name: "run", arguments: oversized });
  assert.equal(call.inputTruncated, true);
  assert.ok(new TextEncoder().encode(call.input).byteLength <= MAX_EXECUTION_FIELD_BYTES);

  const limited = limitExecutionEntryDetail({
    input: "a".repeat(200_000),
    output: "b".repeat(200_000),
    inputTruncated: false,
    outputTruncated: false
  }, 250_000);
  assert.equal(limited.input.length, 200_000);
  assert.equal(limited.output.length, 50_000);
  assert.equal(limited.outputTruncated, true);
  assert.equal(executionDetailBytes(limited), 250_000);
});

test("peer execution detail accepts exact bounded strings and rejects malformed fields", () => {
  const detail = normalizePeerExecutionDetail({
    callId: "call-1",
    input: "  raw input  ",
    output: "<script>alert(1)</script>\n",
    inputTruncated: false,
    outputTruncated: true
  });
  assert.equal(detail.input, "  raw input  ");
  assert.equal(detail.output, "<script>alert(1)</script>\n");
  assert.equal(detail.outputTruncated, true);

  assert.throws(() => normalizePeerExecutionDetail({ callId: "bad\nid" }), /call id is invalid/);
  assert.throws(() => normalizePeerExecutionDetail({ input: { command: "pwd" } }), /input is invalid/);
  assert.throws(() => normalizePeerExecutionDetail({ input: "x", inputTruncated: "yes" }), /truncation is invalid/);
  assert.throws(() => normalizePeerExecutionDetail({ output: "x".repeat(MAX_EXECUTION_FIELD_BYTES + 1) }), /too large/);
});
