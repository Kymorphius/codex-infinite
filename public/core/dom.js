export function createDomServices(documentRef = document) {
  const $ = (selector) => documentRef.querySelector(selector);
  const toast = $('[data-testid="toast"]');

  function showToast(message, duration = 3800) {
    toast.textContent = message;
    toast.classList.remove("hidden");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.add("hidden"), duration);
  }

  function setScopedState(panel, attribute, responseStatus, message = "") {
    for (const element of panel.querySelectorAll(`[${attribute}]`)) {
      element.classList.toggle("hidden", element.getAttribute(attribute) !== responseStatus);
    }
    for (const messageElement of panel.querySelectorAll(`[${attribute}-message]`)) {
      if (message) messageElement.textContent = message;
    }
  }

  return { $, setScopedState, showToast };
}
