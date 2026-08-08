/**
 * Cloudflare Pages Functions Schema 检测工具
 * 路径: /functions/_lib/schema.js
 *
 * 用途: S09 后台数据中心升级的数据库兼容层。
 * 线上 D1 可能尚未执行迁移（S09），新增 API 通过本工具检测
 * 表/字段是否存在，决定 SQL 是否包含新列/新表，保证：
 *   - 迁移前：现有接口不报错，新 API 走基础字段降级
 *   - 迁移后：自动启用新字段完整能力
 *
 * 实现说明:
 *   - 使用 pragma_table_info / sqlite_master 查询（D1 支持绑定参数）
 *   - 模块级 Map 缓存检测结果，避免同一 isolate 内重复 pragma 查询
 */

const tableCache = new Map();
const columnCache = new Map();

/**
 * 检查表是否存在
 * @param {object} env - Cloudflare 环境（含 DB）
 * @param {string} table - 表名
 * @returns {Promise<boolean>}
 */
export async function hasTable(env, table) {
  if (!env || !env.DB) return false;
  const key = 't:' + table;
  if (tableCache.has(key)) return tableCache.get(key);

  try {
    const row = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`
    ).bind(table).first();
    const exists = !!row;
    tableCache.set(key, exists);
    return exists;
  } catch (e) {
    console.error('schema.hasTable(' + table + ') failed:', e.message);
    return false;
  }
}

/**
 * 检查表字段是否存在
 * @param {object} env - Cloudflare 环境（含 DB）
 * @param {string} table - 表名
 * @param {string} column - 字段名
 * @returns {Promise<boolean>}
 */
export async function hasColumn(env, table, column) {
  if (!env || !env.DB) return false;
  const key = 'c:' + table + '.' + column;
  if (columnCache.has(key)) return columnCache.get(key);

  try {
    const row = await env.DB.prepare(
      `SELECT name FROM pragma_table_info(?) WHERE name = ?`
    ).bind(table, column).first();
    const exists = !!row;
    columnCache.set(key, exists);
    return exists;
  } catch (e) {
    console.error('schema.hasColumn(' + table + '.' + column + ') failed:', e.message);
    return false;
  }
}