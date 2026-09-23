export function readHeldViews() {
  try {
    const values = JSON.parse(localStorage.getItem(VIEW_KEY) || '{}');
    return values && typeof values === 'object' && !Array.isArray(values) ? values : {};
  } catch { return {}; }
}

export function readHeldView(id) { return ['manage', 'sort', 'time'].includes(readHeldViews()[id]) ? readHeldViews()[id] : 'manage'; }
