export function createChecklistTimePresentation(readMetadata) {
  const timestamp = item => {
    const value = readMetadata(item).createdAt;
    return value === null ? Infinity : Date.parse(value);
  };
  function order(items) {
    return items.map((item, index) => ({ item, index, time: timestamp(item) }))
      .sort((a, b) => (a.time === b.time ? a.index - b.index : a.time - b.time)).map(entry => entry.item);
  }
  function describe(item) {
    const { createdAt, createdAtEstimated } = readMetadata(item);
    if (createdAt === null) return { dateTime: '', label: '时间未记录', title: '旧版未记录可用的加入时间。' };
    const date = new Date(createdAt), pad = value => String(value).padStart(2, '0');
    const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    return {
      dateTime: createdAt,
      label: `${day} ${clock}${createdAtEstimated ? ' · 估算' : ''}`,
      title: createdAtEstimated ? `原始加入时间未记录；根据旧版最后保存时间估算：${day} ${clock}:${pad(date.getSeconds())}` : `最初加入时间：${day} ${clock}:${pad(date.getSeconds())}`
    };
  }
  return { order, describe };
}
