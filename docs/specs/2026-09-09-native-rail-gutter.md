# Preserve the native message rail beside output cards

The native renderer requires at least 48 CSS pixels between the scroll viewport left edge and the message content. A wide output panel shifts the content left, reducing this to about 21px and causing the native rail component to return null even with many messages.

When annotation navigation is installed, constrain content max-width using the scroll viewport and its parent's horizontal shift, reserving a 52px gutter. Keep the native max-width cap and leave narrow layouts alone when less than 360px of content would remain. Restore prior inline width when leaving the conversation or disposing. Keep native marker rendering, previews and interaction unchanged; its existing minimum item count still applies.

Verify computed gutter >=48px and rendered native markers alongside the enhanced turn rail in a real long conversation, including after resizing. Test width calculation, narrow/invalid dimensions, restoration and preserving later unrelated inline changes. Ship the same builder to the owner and panel.

Verification completed: original check and 548 tests pass. Installed panel check and 33 tests pass. In a live viewport with output-card shift -158px, reserving the gutter restored 52 native markers. After deployment, the independent owner rendered 194 native markers in 统一双 Mac 开发环境; the panel rendered 29 native markers plus the enhanced left rail in PAL-添加通话中心与拦截功能. Native rail DOM was visible with opacity 1 and nonzero bounds. Panel screenshot inspected. Owner screenshot capture timed out, so owner acceptance uses live rendered DOM bounds; its navigation was restored after the check. Resize and inline-style restoration are covered by focused tests.
