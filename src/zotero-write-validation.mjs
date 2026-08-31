export const EDITABLE_FIELDS = ["title", "abstractNote", "date", "url", "DOI", "ISBN", "publicationTitle"];
const EDITABLE_FIELD_SET = new Set(EDITABLE_FIELDS);
export const CREATE_ITEM_TYPES = new Set(["book", "journalArticle", "webpage"]);
const LIST_FIELDS = ["creators", "tags", "collections"];
const LIST_FIELD_SET = new Set(LIST_FIELDS);
const ROOT_UPDATE_FIELDS = new Set(["version", "fields", "creators", "tags", "collections", "completeLists"]);
const ROOT_CREATE_FIELDS = new Set(["itemType", "fields", "creators", "tags", "collections"]);

export function asHeader(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return headers.get(name) || "";
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return entry ? String(entry[1]) : "";
}

export function integer(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function text(value, maximum = 20000) {
  if (typeof value !== "string") throw new Error("文本字段必须是字符串");
  const result = value.trim();
  if (result.length > maximum) throw new Error("文本字段过长");
  return result;
}

export function optionalText(value, maximum = 20000) {
  if (value === undefined || value === null) return "";
  return text(value, maximum);
}

export function assertPlainObject(value, message = "请求格式无效") {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value;
}

export function assertAllowedKeys(value, allowed) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error("请求包含不支持的字段");
}

export function itemKey(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) throw new Error("Zotero 条目标识无效");
  return value;
}

export function collectionKey(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) throw new Error("Zotero 集合标识无效");
  return value;
}

function validateFields(value, { required = false } = {}) {
  if (value === undefined && !required) return {};
  const fields = assertPlainObject(value, "文献字段格式无效");
  assertAllowedKeys(fields, EDITABLE_FIELD_SET);
  const output = {};
  for (const [key, fieldValue] of Object.entries(fields)) output[key] = text(fieldValue, key === "abstractNote" ? 50000 : 4000);
  return output;
}

function validateCreator(value) {
  const creator = assertPlainObject(value, "作者格式无效");
  assertAllowedKeys(creator, new Set(["creatorType", "firstName", "lastName", "name"]));
  const creatorType = text(creator.creatorType || "author", 80);
  const firstName = optionalText(creator.firstName, 500);
  const lastName = optionalText(creator.lastName, 500);
  const name = optionalText(creator.name, 1000);
  if (!name && !firstName && !lastName) throw new Error("作者不能为空");
  const output = { creatorType };
  if (name) output.name = name;
  else {
    if (firstName) output.firstName = firstName;
    if (lastName) output.lastName = lastName;
  }
  return output;
}

function validateCreators(value, { required = false } = {}) {
  if (value === undefined && !required) return undefined;
  if (!Array.isArray(value) || value.length > 200) throw new Error("作者完整列表格式无效");
  return value.map(validateCreator);
}

function validateTag(value) {
  const tag = assertPlainObject(value, "标签格式无效");
  assertAllowedKeys(tag, new Set(["tag", "type"]));
  const output = { tag: text(tag.tag, 500) };
  if (tag.type !== undefined) {
    const type = integer(tag.type);
    if (type === null || type > 100) throw new Error("标签类型无效");
    output.type = type;
  }
  return output;
}

function validateTags(value, { required = false } = {}) {
  if (value === undefined && !required) return undefined;
  if (!Array.isArray(value) || value.length > 500) throw new Error("标签完整列表格式无效");
  return value.map(validateTag);
}

function validateCollections(value, { required = false } = {}) {
  if (value === undefined && !required) return undefined;
  if (!Array.isArray(value) || value.length > 200) throw new Error("集合完整列表格式无效");
  return value.map(collectionKey);
}

function validateCompleteLists(value, body) {
  if (!Array.isArray(value)) throw new Error("完整列表确认缺失");
  const names = [...new Set(value)];
  if (names.some((name) => !LIST_FIELD_SET.has(name))) throw new Error("完整列表字段无效");
  for (const name of names) if (!Object.hasOwn(body, name)) throw new Error("完整列表必须显式提交");
  return names;
}

export function validateUpdateInput(input) {
  const body = assertPlainObject(input);
  assertAllowedKeys(body, ROOT_UPDATE_FIELDS);
  const version = integer(body.version);
  if (version === null) throw new Error("文献版本号缺失");
  const fields = validateFields(body.fields);
  const completeLists = validateCompleteLists(body.completeLists, body);
  const creators = completeLists.includes("creators") ? validateCreators(body.creators, { required: true }) : undefined;
  const tags = completeLists.includes("tags") ? validateTags(body.tags, { required: true }) : undefined;
  const collections = completeLists.includes("collections") ? validateCollections(body.collections, { required: true }) : undefined;
  return { version, fields, creators, tags, collections, completeLists };
}

export function validateCreateInput(input) {
  const body = assertPlainObject(input);
  assertAllowedKeys(body, ROOT_CREATE_FIELDS);
  const itemType = text(body.itemType, 80);
  if (!CREATE_ITEM_TYPES.has(itemType)) throw new Error("当前只支持书籍、期刊文章或网页条目");
  const fields = validateFields(body.fields, { required: true });
  const creators = validateCreators(body.creators, { required: true });
  const tags = validateTags(body.tags, { required: true });
  const collections = validateCollections(body.collections, { required: true });
  return { itemType, fields, creators, tags, collections };
}

