/**
 * Cloudflare Pages Function UA 解析工具
 * 路径: /functions/_lib/ua.js
 *
 * 纯正则解析 User-Agent，无外部依赖：
 * - device: mobile / desktop / tablet / unknown
 * - os: iOS / Android / Windows / macOS / Linux / 其他 / 未知
 * - browser: Chrome / Safari / Firefox / Edge / WeChat / 其他 / 未知
 */

/**
 * 解析 User-Agent，返回设备/系统/浏览器
 * @param {string} ua - User-Agent 字符串
 * @returns {{ device: string, os: string, browser: string }}
 */
export function parseUA(ua = '') {
  const s = String(ua || '');

  // 设备类型
  let device = 'desktop';
  if (/iPad|Tablet/i.test(s)) {
    device = 'tablet';
  } else if (/Mobile|iPhone|Android|iPod|Windows Phone|MicroMessenger/i.test(s)) {
    device = 'mobile';
  }

  // 操作系统
  let os = '其他';
  if (/iPhone|iPad|iPod/i.test(s)) {
    os = 'iOS';
  } else if (/Android/i.test(s)) {
    os = 'Android';
  } else if (/Windows/i.test(s)) {
    os = 'Windows';
  } else if (/Macintosh|Mac OS/i.test(s)) {
    os = 'macOS';
  } else if (/Linux/i.test(s)) {
    os = 'Linux';
  }
  if (!s) os = '未知';

  // 浏览器
  let browser = '其他';
  if (/MicroMessenger/i.test(s)) {
    browser = 'WeChat';
  } else if (/Edg\//i.test(s)) {
    browser = 'Edge';
  } else if (/Chrome|CriOS/i.test(s)) {
    browser = 'Chrome';
  } else if (/Firefox|FxiOS/i.test(s)) {
    browser = 'Firefox';
  } else if (/Safari/i.test(s)) {
    browser = 'Safari';
  }
  if (!s) browser = '未知';

  return { device, os, browser };
}