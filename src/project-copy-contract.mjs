import path from "node:path";

const DEVICE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const MAX_PATH_LENGTH = 1024;

function requiredString(value, label) {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result || result.length > MAX_PATH_LENGTH || /[\0\r\n]/.test(result)) throw new Error(`${label}无效`);
  return result;
}
export function normalizeWindowsSourcePath(value) {
  let result = requiredString(value, "源目录");
  if (result.startsWith("\\\\?\\UNC\\")) result = `\\\\${result.slice(8)}`;
  else if (result.startsWith("\\\\?\\")) result = result.slice(4);
  if (!/^[A-Za-z]:\\[^\0\r\n]+$/.test(result)) throw new Error("Windows 源目录必须是绝对路径");
  return path.win32.normalize(result);
}

export function normalizeDestinationPath(value, allowedRoots = []) {
  const input = requiredString(value, "目标目录");
  if (!path.isAbsolute(input)) throw new Error("目标目录必须是绝对路径");
  const result = path.resolve(input);
  const permitted = allowedRoots.map((root) => path.resolve(root)).some((root) => result !== root && result.startsWith(`${root}${path.sep}`));
  if (!permitted) throw new Error("目标目录不在允许的本机目录中");
  return result;
}

export function validateProjectCopySelection(input = {}, { allowedRoots = [] } = {}) {
  const deviceId = requiredString(input.deviceId, "设备");
  if (!DEVICE_ID.test(deviceId)) throw new Error("设备标识无效");
  return Object.freeze({
    deviceId,
    sourceDirectory: normalizeWindowsSourcePath(input.sourceDirectory),
    destinationDirectory: normalizeDestinationPath(input.destinationDirectory, allowedRoots)
  });
}

export function validatePreflightToken(value) {
  const token = typeof value === "string" ? value : "";
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("复制预检凭据无效");
  return token;
}

export function isSafeTransferName(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 255 && !/[\0\r\n"/\\]/.test(value) && value !== "." && value !== "..";
}
