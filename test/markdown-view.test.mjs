import test from "node:test";
import assert from "node:assert/strict";
import { inlineMarkdownTokens, parseMarkdownBlocks } from "../public/features/sessions/markdown-view.js";
import { presentConversationEntries } from "../public/features/sessions/conversation-model.js";

test("remote conversation Markdown recognizes native conversation block structure", () => {
  assert.deepEqual(parseMarkdownBlocks("## 标题\n\n- 一\n- 二\n\n```rs\nfn main() {}\n```"), [
    { type: "heading", level: 2, text: "标题" },
    { type: "list", ordered: false, items: ["一", "二"] },
    { type: "code", language: "rs", text: "fn main() {}" }
  ]);
});

test("remote conversation inline Markdown keeps raw HTML inert and bounds links to HTTP", () => {
  assert.deepEqual(inlineMarkdownTokens("**粗体**、`代码`和[链接](https://example.com) <script>x</script>"), [
    { type: "strong", text: "粗体" }, { type: "text", text: "、" }, { type: "code", text: "代码" },
    { type: "text", text: "和" }, { type: "link", text: "链接", href: "https://example.com" },
    { type: "text", text: " <script>x</script>" }
  ]);
  assert.deepEqual(inlineMarkdownTokens("[危险](javascript:alert(1))"), [{ type: "text", text: "[危险](javascript:alert(1))" }]);
});

test("remote conversation restores the explicit user request from attachment envelopes", () => {
  const [entry] = presentConversationEntries([{ kind: "message", role: "user", text: [
    "# Files mentioned by the user:", "", "## image.png: C:/private/image.png", "", "Distinguish attached instructions.", "",
    "## My request:", "[OA](https://oa.example.com)", "请打开二维码登录", "", '<image name="reference"></image>'
  ].join("\n") }]);
  assert.equal(entry.role, "user");
  assert.equal(entry.text, "[OA](https://oa.example.com)\n请打开二维码登录");
});
