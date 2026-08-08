/**
 * SoulMirror 全站统一埋点 SDK
 * 路径: /track.js
 *
 * 功能:
 *   1. 自动页面访问上报（单页面仅一次，/api/view）
 *   2. trackEvent(action, data) 统一业务事件上报（/api/event）
 *   3. visitor_token 匿名身份管理（localStorage 优先，cookie 备用，长期保存）
 *
 * 性能:
 *   - navigator.sendBeacon 优先（页面卸载也能送达）
 *   - fetch keepalive 备用
 *   - 全部异步，不阻塞页面渲染
 *   - 上报失败静默忽略，不影响业务
 *
 * 安全:
 *   - 不记录密码/token/邮箱/私人聊天内容
 *   - detail 只保存业务 ID 和统计信息
 *   - detail 超过 200 字符截断，触发敏感内容过滤时丢弃
 */
(function () {
  'use strict';

  /* ==================== Cookie 工具 ==================== */

  function getCookie(name) {
    try {
      var m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
      return m ? decodeURIComponent(m[1]) : null;
    } catch (e) { return null; }
  }

  function setCookie(name, value, days) {
    try {
      var expires = '';
      if (days) {
        var d = new Date();
        d.setTime(d.getTime() + days * 86400000);
        expires = '; expires=' + d.toUTCString();
      }
      document.cookie = name + '=' + encodeURIComponent(value) + expires + '; path=/; SameSite=Lax';
    } catch (e) { /* cookie 不可用时忽略 */ }
  }

  /* ==================== visitor_token 管理 ==================== */

  var STORAGE_KEY = 'sm_visitor_token';
  var COOKIE_KEY = 'sm_vt';

  function generateToken() {
    // 生成 sm_t_<随机串>，仅用于匿名行为关联，不含任何敏感信息
    var rand = '';
    try {
      if (window.crypto && crypto.getRandomValues) {
        var arr = new Uint8Array(16);
        crypto.getRandomValues(arr);
        for (var i = 0; i < arr.length; i++) {
          rand += ('0' + arr[i].toString(16)).slice(-2);
        }
      }
    } catch (e) {}
    if (!rand) {
      // 降级: Math.random 拼接时间戳
      rand = Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
    }
    return 'sm_t_' + rand;
  }

  /**
   * 获取或创建访客身份。
   * 优先级: localStorage sm_visitor_token → cookie sm_vt → cookie visitor_token → cookie visitor_id → 新建
   * 生命周期: 长期保存（localStorage 永久 / cookie 1 年）
   */
  function getOrCreateVisitorToken() {
    var token = null;
    try { token = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (token) return token;

    token = getCookie(COOKIE_KEY) || getCookie('visitor_token') || getCookie('visitor_id');
    if (token) {
      try { localStorage.setItem(STORAGE_KEY, token); } catch (e) {}
      return token;
    }

    token = generateToken();
    try { localStorage.setItem(STORAGE_KEY, token); } catch (e) {}
    setCookie(COOKIE_KEY, token, 365);
    return token;
  }

  /* ==================== 发送工具 ==================== */

  function send(url, data) {
    try {
      var payload = JSON.stringify(data);

      // 首选 sendBeacon（页面卸载场景也能送达）
      if (navigator.sendBeacon) {
        try {
          var blob = new Blob([payload], { type: 'application/json' });
          if (navigator.sendBeacon(url, blob)) return;
        } catch (e) {}
      }

      // 备用 fetch keepalive（异步、不阻塞、失败静默）
      try {
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          credentials: 'include',
          keepalive: true,
        }).catch(function () {});
      } catch (e) {}
    } catch (e) { /* 任何异常都不影响业务 */ }
  }

  /* ==================== 自动页面访问（单次） ==================== */

  var pageViewSent = false;

  function normalizePagePath() {
    var p = location.pathname || '/';
    if (p === '/') return '/index.html';
    return p;
  }

  function trackPageView() {
    if (pageViewSent) return;
    pageViewSent = true; // 防重复（load + setTimeout 双保险）

    send('/api/view', {
      page: normalizePagePath(),
      referrer: document.referrer,
      visitorToken: getOrCreateVisitorToken(),
    });
  }

  // 页面加载完成后上报；load 兜底 + 定时兜底（防 SPA 跳转丢事件）
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    // 等主渲染完成，延迟少量时间避免与业务脚本竞争
    setTimeout(trackPageView, 300);
  } else {
    // loading 状态：立即异步发送一次（sendBeacon/fetch 不阻塞渲染，兼容跳转页如 admin.html）
    setTimeout(trackPageView, 0);
  }
  window.addEventListener('load', function () {
    setTimeout(trackPageView, 100);
  });
  setTimeout(trackPageView, 1500);

  /* ==================== 业务事件映射 ==================== */

  // 前端业务事件名 → 后端标准 action（/api/event 白名单）
  var ACTION_MAP = {
    register_success: 'register',
    login_success: 'login',
    create_profile: 'profile_created',
    quiz_start: 'quiz_start',
    quiz_complete: 'quiz_completed',
    quiz_view_result: 'quiz_view_result',
    askbox_view: 'askbox_view',
    askbox_question_submit: 'askbox_question',
    askbox_view_answer: 'askbox_view_answer',
    tarot_start: 'tarot_start',
    tarot_complete: 'tarot_analyze',
    tarot_history_view: 'tarot_history_view',
    match_view: 'match_view',
    chat_start: 'chat_start',
    share: 'share',
    favorite_add: 'favorite_add',
    favorite_remove: 'favorite_remove',
    wall_post: 'wall_post',
    wall_like: 'wall_like',
    moment_post: 'moment_post',
    memory_import: 'memory_import',
    contact_request: 'contact_request',
  };

  // detail 安全过滤：不允许邮箱/长文本/敏感字段
  function sanitizeDetail(val) {
    if (val === undefined || val === null) return '';
    var s = String(val).trim().slice(0, 200);
    if (!s) return '';
    // 含 @（疑似邮箱）或含空格过多（疑似长文本/聊天内容）时丢弃
    if (s.indexOf('@') !== -1) return '';
    return s;
  }

  /**
   * trackEvent(action, data)
   * data 支持字段:
   *   - user_id / target_user_id / askbox_id / quiz_type / spread_type / page
   *   - 任意键值，仅提取 ID/类型等统计信息写入 detail，不记录敏感内容
   */
  function trackEvent(action, data) {
    try {
      var rawAction = String(action || '').trim().slice(0, 50);
      if (!rawAction) return;

      // 映射为后端标准 action；无映射则透传（后端白名单外降级 other）
      var safeAction = ACTION_MAP[rawAction] || rawAction;
      var d = data || {};

      // 推断 target_type / target_id（仅 ID 类，安全）
      var targetType = String(d.target_type || '').trim().slice(0, 30);
      var targetId = null;
      if (d.target_id !== undefined && d.target_id !== null) {
        targetId = String(d.target_id).slice(0, 50);
      } else if (d.askbox_id !== undefined && d.askbox_id !== null) {
        targetType = targetType || 'askbox';
        targetId = String(d.askbox_id).slice(0, 50);
      } else if (d.target_user_id !== undefined && d.target_user_id !== null) {
        targetType = targetType || 'user';
        targetId = String(d.target_user_id).slice(0, 50);
      } else if (d.user_id !== undefined && d.user_id !== null && action === 'register_success') {
        targetType = targetType || 'user';
        targetId = String(d.user_id).slice(0, 50);
      }

      // detail: 只保留 ID/类型/统计 + 可选简短描述，含 @ 自动丢弃
      var parts = [];
      if (d.quiz_type) parts.push('quiz=' + sanitizeDetail(d.quiz_type));
      if (d.spread_type) parts.push('spread=' + sanitizeDetail(d.spread_type));
      if (d.page) parts.push('page=' + sanitizeDetail(d.page));
      if (d.detail) parts.push(sanitizeDetail(d.detail));
      var detail = parts.filter(Boolean).join('|').slice(0, 200);

      send('/api/event', {
        action: safeAction,
        page: normalizePagePath(),
        target_type: targetType,
        target_id: targetId,
        detail: detail,
        referrer: document.referrer,
      });
    } catch (e) { /* 埋点异常不影响业务 */ }
  }

  /* ==================== 导出全局接口 ==================== */

  window.trackEvent = trackEvent;
  // 兼容旧命名（部分页面可能引用 trackEvent）
  window.SMTrack = { trackEvent: trackEvent, getVisitorToken: getOrCreateVisitorToken };

  // DOMContentLoaded 前暴露，供页面业务回调使用
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      window.trackEvent = trackEvent;
      window.SMTrack = { trackEvent: trackEvent, getVisitorToken: getOrCreateVisitorToken };
    });
  }
})();