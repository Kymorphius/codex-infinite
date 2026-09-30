const entry = document.getElementById('conversation-copy-entry');
if (entry) {
  fetch('/conversation-copy.html', { method: 'HEAD', cache: 'no-store' })
    .then(response => { entry.hidden = !response.ok; })
    .catch(() => { entry.hidden = true; });
}
