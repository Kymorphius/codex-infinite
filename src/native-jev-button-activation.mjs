// The native shell can suppress the synthetic click after a composer-footer
// pointer gesture. Complete the gesture on pointerup, and retain click for
// keyboard activation. The guard makes each physical gesture one toggle.
export function installNativeJevButtonActivation(button, activate) {
  let ignoreClickUntil = 0;
  const invoke = (event, fromPointer) => {
    if (button.disabled) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (fromPointer) ignoreClickUntil = Date.now() + 750;
    void activate();
  };
  button.addEventListener('pointerup', (event) => {
    if (event.button !== 0) return;
    invoke(event, true);
  });
  button.addEventListener('click', (event) => {
    if (Date.now() < ignoreClickUntil) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    invoke(event, false);
  });
}
