const ITEM_TYPE_LABELS = {
  journalArticle: "期刊文章",
  book: "图书",
  bookSection: "图书章节",
  conferencePaper: "会议论文",
  thesis: "学位论文",
  report: "报告",
  preprint: "预印本",
  webpage: "网页",
  document: "文档",
  dataset: "数据集",
  patent: "专利",
  presentation: "演示文稿"
};

export const EDITABLE_FIELDS = ["title", "abstractNote", "date", "url", "DOI", "ISBN", "publicationTitle"];

export function typeLabel(type) {
  return ITEM_TYPE_LABELS[type] || type || "其他条目";
}

export function itemDate(item) {
  if (item.year) return String(item.year);
  return item.date || "日期未知";
}

export function formatCount(value) {
  return new Intl.NumberFormat("zh-CN").format(Number(value) || 0);
}

export function splitLines(value) {
  return String(value || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

export function parseCreatorLines(value) {
  return splitLines(value).map((line) => {
    const separator = line.indexOf("|");
    const creatorType = separator > 0 ? line.slice(0, separator).trim() : "author";
    const name = (separator > 0 ? line.slice(separator + 1) : line).trim();
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length > 1 && creatorType !== "editor") {
      return { creatorType, firstName: parts.slice(0, -1).join(" "), lastName: parts.at(-1) };
    }
    return { creatorType, name };
  });
}

export function formatCreatorLines(creators) {
  return (creators || []).map((creator) => {
    const name = creator.name || [creator.firstName, creator.lastName].filter(Boolean).join(" ");
    return `${creator.creatorType || "author"}|${name}`;
  }).join("\n");
}

export function formatTagLines(tags) {
  return (tags || []).map((tag) => typeof tag === "string" ? tag : tag.tag).filter(Boolean).join("\n");
}

export function writeStatusLabel(status) {
  if (!status) return "检测中…";
  if (status.status === "offline" || status.localApi === "offline") return "Zotero 未运行";
  if (status.authorization === "authorized" || status.writeEnabled) return "回写已连接";
  if (status.authorization === "denied") return "授权被拒绝";
  if (status.status === "connected" || status.authorization === "required" || status.status === "forgot") return "需要授权";
  return "回写不可用";
}
