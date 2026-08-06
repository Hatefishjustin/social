/**
 * Cloudflare Pages Function UA 解析工具
 * 路径: /functions/_lib/ua.js
 *
 * 纯正则解析 User-Agent，无外部依赖：
 * - device: mobile / desktop / tablet / unknown
 * - os: iOS / Android / Windows / macOS / Linux / 其他 / 未知（含版本号，如 'iOS 17.5'、'Windows 10'）
 * - browser: Chrome / Safari / Firefox / Edge / WeChat / 其他 / 未知（含版本号，如 'Chrome 126'）
 */

/**
 * 解析 User-Agent，返回设备/系统/浏览器（含版本号）
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

  // 操作系统（含版本）
  let os = '其他';
  const osVerMatch = (re) => {
    const m = s.match(re);
    return m && m[1] ? m[1] : '';
  };
  if (/iPhone|iPad|iPod/i.test(s)) {
    const ver = osVerMatch(/OS (\d+[._]\d+)/);
    os = 'iOS' + (ver ? ' ' + ver.replace('_', '.') : '');
  } else if (/Android/i.test(s)) {
    const ver = osVerMatch(/Android (\d+(?:\.\d+)?)/);
    os = 'Android' + (ver ? ' ' + ver : '');
  } else if (/Windows/i.test(s)) {
    if (/Windows NT 10\.0/.test(s)) os = 'Windows 10/11';
    else if (/Windows NT 6\.3/.test(s)) os = 'Windows 8.1';
    else if (/Windows NT 6\.1/.test(s)) os = 'Windows 7';
    else if (/Windows Phone/.test(s)) os = 'Windows Phone';
    else os = 'Windows';
  } else if (/Macintosh|Mac OS/i.test(s)) {
    const ver = osVerMatch(/Mac OS X (\d+[._]\d+)/);
    os = 'macOS' + (ver ? ' ' + ver.replace('_', '.') : '');
  } else if (/Linux/i.test(s)) {
    os = 'Linux';
  }
  if (!s) os = '未知';

  // 浏览器（含版本）
  let browser = '其他';
  const bVer = (re) => {
    const m = s.match(re);
    return m && m[1] ? m[1] : '';
  };
  if (/MicroMessenger/i.test(s)) {
    const ver = bVer(/MicroMessenger\/(\d+(?:\.\d+)*)/);
    browser = 'WeChat' + (ver ? ' ' + ver : '');
  } else if (/Edg\//i.test(s)) {
    const ver = bVer(/Edg\/(\d+(?:\.\d+)*)/);
    browser = 'Edge' + (ver ? ' ' + ver : '');
  } else if (/CriOS\//i.test(s)) {
    const ver = bVer(/CriOS\/(\d+(?:\.\d+)*)/);
    browser = 'Chrome' + (ver ? ' ' + ver : '');
  } else if (/Chrome\//i.test(s)) {
    const ver = bVer(/Chrome\/(\d+(?:\.\d+)*)/);
    browser = 'Chrome' + (ver ? ' ' + ver : '');
  } else if (/FxiOS\//i.test(s)) {
    const ver = bVer(/FxiOS\/(\d+(?:\.\d+)*)/);
    browser = 'Firefox' + (ver ? ' ' + ver : '');
  } else if (/Firefox\//i.test(s)) {
    const ver = bVer(/Firefox\/(\d+(?:\.\d+)*)/);
    browser = 'Firefox' + (ver ? ' ' + ver : '');
  } else if (/Version\/(\d+(?:\.\d+)*).*Safari\//.test(s)) {
    const ver = bVer(/Version\/(\d+(?:\.\d+)*)/);
    browser = 'Safari' + (ver ? ' ' + ver : '');
  } else if (/Safari\//i.test(s)) {
    browser = 'Safari';
  }
  if (!s) browser = '未知';

  return { device, os, browser };
}
