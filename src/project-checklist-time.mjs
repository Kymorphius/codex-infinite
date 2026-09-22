export function checklistTimeMetadata(item) {
  const iso = value => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
    const timestamp = Date.parse(value), year = Number(value.slice(0, 4)), month = Number(value.slice(5, 7)), day = Number(value.slice(8, 10));
    const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (!Number.isFinite(timestamp) || month < 1 || month > 12 || day < 1 || day > days[month - 1] || Number(value.slice(11, 13)) > 23) return null;
    return new Date(timestamp).toISOString();
  };
  if (item && Object.prototype.hasOwnProperty.call(item, 'createdAt')) {
    const createdAt = iso(item.createdAt);
    return { createdAt, createdAtEstimated: createdAt !== null && item.createdAtEstimated === true };
  }
  if (Number.isFinite(item?.heldAt) && Math.abs(item.heldAt) <= 8_640_000_000_000_000) return { createdAt: new Date(item.heldAt).toISOString(), createdAtEstimated: false };
  const createdAt = iso(item?.updatedAt);
  return { createdAt, createdAtEstimated: createdAt !== null };
}
