import fs from "node:fs/promises";
import path from "node:path";

export class ProjectCopyReceiptStore {
  constructor({ filePath } = {}) { this.filePath = filePath; }

  async append(receipt) {
    let current = { version: 1, copies: [] };
    try { current = JSON.parse(await fs.readFile(this.filePath, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
    const copies = Array.isArray(current.copies) ? current.copies.slice(-99) : [];
    copies.push(receipt);
    await fs.mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify({ version: 1, copies }, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temporary, this.filePath);
    return receipt;
  }
}
