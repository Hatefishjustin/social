/**
 * auth.js - 心镜·社交 共享登录模块
 * 所有子站（index / campus / qa / match）引入此文件即可获得统一的登录体验
 * 后端依赖：POST /auth/request  GET /auth/verify  GET /session  GET|POST /logout
 */
(function(){
'use strict';

var user = null;
var listeners = [];

function emit() {
  var e = new CustomEvent('authchange', { detail: user });
  window.dispatchEvent(e);
  listeners.forEach(function(f){ f(user); });
}

async function refresh() {
  try {
    var r = await fetch('/session', { credentials: 'same-origin' });
    var d = await r.json();
    user = d.loggedIn ? d : null;
  } catch(e) {
    user = null;
  }
  updateNavUI();
  emit();
  return user;
}

function isLoggedIn()  { return user !== null; }
function getUserId()   { return user ? user.userId : null; }
function getEmail()    { return user ? user.email : null; }
function getUser()     { return user; }
function onAuthChange(fn) { listeners.push(fn); }

async function requestLogin(email, pendingResult) {
  var body = { email: email };
  if (pendingResult) body.pendingResult = pendingResult;
  var r = await fetch('/auth/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return await r.json();
}

function logout() {
  window.location.href = '/logout';
}

/* ── Nav UI ── */
function updateNavUI() {
  var btns = document.querySelectorAll('.auth-login-btn, .auth-user-btn');
  btns.forEach(function(btn){
    if (isLoggedIn()) {
      var email = getEmail() || '';
      var short = email ? email.split('@')[0] : '我';
      btn.textContent = short;
      btn.className = btn.className.replace('auth-login-btn','auth-user-btn');
      btn.title = email;
      btn.onclick = function(e){ e.stopPropagation(); showUserMenu(btn); };
    } else {
      btn.textContent = '登录';
      btn.className = btn.className.replace('auth-user-btn','auth-login-btn');
      btn.title = '';
      btn.onclick = function(e){ e.stopPropagation(); showLoginModal(); };
    }
  });
}

/* ── 登录弹窗 ── */
function showLoginModal() {
  var ex = document.getElementById('auth-modal-overlay');
  if (ex) ex.remove();

  var overlay = document.createElement('div');
  overlay.id = 'auth-modal-overlay';
  overlay.className = 'auth-overlay';
  overlay.setAttribute('role','dialog');
  overlay.setAttribute('aria-label','登录');

  var html = '';
  html += '<div class="auth-sheet">';
  html += '<div class="auth-handle"></div>';
  html += '<div class="auth-title">登录心镜·社交</div>';
  html += '<div class="auth-desc">输入邮箱，我们会发送一个魔法链接，点击即可登录</div>';
  html += '<input type="email" class="auth-input" id="authEmailInput" placeholder="your@email.com" autocomplete="email" inputmode="email">';
  html += '<div class="auth-err" id="authErr"></div>';
  html += '<div class="auth-success" id="authSuccess" style="display:none"></div>';
  html += '<button class="auth-submit" id="authSubmit">发送验证邮件</button>';
  html += '<button class="auth-cancel" id="authCancel">取消</button>';
  html += '</div>';
  overlay.innerHTML = html;
  document.body.appendChild(overlay);

  requestAnimationFrame(function(){ overlay.classList.add('show'); });

  var emailInput = overlay.querySelector('#authEmailInput');
  var errEl      = overlay.querySelector('#authErr');
  var successEl  = overlay.querySelector('#authSuccess');
  var submitBtn  = overlay.querySelector('#authSubmit');

  function close() {
    overlay.classList.remove('show');
    setTimeout(function(){ overlay.remove(); }, 350);
  }

  overlay.addEventListener('click', function(e){ if (e.target === overlay) close(); });
  overlay.querySelector('#authCancel').addEventListener('click', close);

  submitBtn.addEventListener('click', async function(){
    var email = emailInput.value.trim();
    if (!email || email.indexOf('@') === -1) {
      errEl.textContent = '请输入有效的邮箱地址';
      return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = '发送中...';
    errEl.textContent = '';

    try {
      var result = await requestLogin(email);
      if (result.ok) {
        emailInput.style.display = 'none';
        submitBtn.style.display = 'none';
        errEl.style.display = 'none';
        successEl.style.display = 'block';
        successEl.innerHTML = '\u2705 ' + (result.message || '验证邮件已发送！请查收邮箱。');
        setTimeout(close, 3500);
      } else {
        errEl.textContent = result.message || '发送失败，请稍后重试';
      }
    } catch(e) {
      errEl.textContent = '网络错误，请稍后重试';
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = '发送验证邮件';
    }
  });

  emailInput.addEventListener('keydown', function(e){
    if (e.key === 'Enter') submitBtn.click();
  });

  setTimeout(function(){ emailInput.focus(); }, 400);
}

/* ── 用户菜单 ── */
function showUserMenu(btn) {
  var menu = document.querySelector('.auth-dropdown');
  if (menu) { menu.remove(); return; }

  menu = document.createElement('div');
  menu.className = 'auth-dropdown';

  var email = getEmail() || '';
  var html = '';
  html += '<div class="auth-dd-email">' + email + '</div>';
  html += '<button class="auth-dd-item" id="authLogoutBtn">退出登录</button>';
  menu.innerHTML = html;

  var rect = btn.getBoundingClientRect();
  menu.style.cssText = 'position:fixed;top:'+(rect.bottom+6)+'px;right:'+(window.innerWidth-rect.right)+'px;z-index:200;';

  document.body.appendChild(menu);
  menu.querySelector('#authLogoutBtn').addEventListener('click', logout);

  setTimeout(function(){
    document.addEventListener('click', function handler(e){
      if (!menu.contains(e.target) && e.target !== btn) {
        menu.remove();
        document.removeEventListener('click', handler);
      }
    });
  }, 100);
}

/* ── CSS 注入 ── */
function injectStyles() {
  if (document.getElementById('auth-styles')) return;
  var style = document.createElement('style');
  style.id = 'auth-styles';
  style.textContent = [
    '.auth-overlay{position:fixed;inset:0;z-index:999;background:rgba(0,0,0,.78);display:flex;align-items:flex-end;justify-content:center;opacity:0;pointer-events:none;transition:opacity .3s;-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px)}',
    '.auth-overlay.show{opacity:1;pointer-events:auto}',
    '.auth-sheet{width:100%;max-width:480px;background:#1a1a1e;border-radius:20px 20px 0 0;padding:28px 24px calc(24px + env(safe-area-inset-bottom,20px));transform:translateY(100%);transition:transform .35s cubic-bezier(.22,1,.36,1)}',
    '.auth-overlay.show .auth-sheet{transform:translateY(0)}',
    '.auth-handle{width:36px;height:4px;border-radius:2px;background:rgba(255,255,255,.15);margin:0 auto 20px}',
    '.auth-title{font-size:18px;font-weight:700;color:#fff;text-align:center;margin-bottom:6px;font-family:-apple-system,"PingFang SC",sans-serif}',
    '.auth-desc{font-size:13px;color:rgba(255,255,255,.45);text-align:center;margin-bottom:20px;line-height:1.5}',
    '.auth-input{width:100%;padding:14px 16px;border-radius:12px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:#fff;font-size:15px;outline:none;font-family:inherit;box-sizing:border-box}',
    '.auth-input:focus{border-color:#FF3B5C;box-shadow:0 0 0 3px rgba(255,59,92,.12)}',
    '.auth-input::placeholder{color:rgba(255,255,255,.25)}',
    '.auth-err{font-size:12px;color:#f87171;min-height:18px;margin-top:6px;padding:0 4px}',
    '.auth-success{font-size:14px;color:#4ade80;text-align:center;margin-top:12px;line-height:1.6}',
    '.auth-submit,.auth-cancel{width:100%;padding:13px;border-radius:100px;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit;border:none;transition:all .2s}',
    '.auth-submit{margin-top:14px;background:#FF3B5C;color:#fff}',
    '.auth-submit:hover{background:#C4293F;box-shadow:0 6px 20px rgba(255,59,92,.25)}',
    '.auth-submit:active{transform:scale(.97)}',
    '.auth-submit:disabled{opacity:.4;pointer-events:none}',
    '.auth-cancel{margin-top:8px;background:transparent;color:rgba(255,255,255,.5);border:1px solid rgba(255,255,255,.08)}',
    '.auth-cancel:active{background:rgba(255,255,255,.04)}',
    '.auth-login-btn,.auth-user-btn{font-size:13px;padding:6px 14px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:transparent;color:rgba(255,255,255,.55);cursor:pointer;font-family:inherit;transition:all .2s;white-space:nowrap;max-width:120px;overflow:hidden;text-overflow:ellipsis}',
    '.auth-login-btn:hover,.auth-user-btn:hover{border-color:rgba(255,255,255,.2);color:rgba(255,255,255,.8)}',
    '.auth-dropdown{background:#1a1a1e;border:1px solid rgba(255,255,255,.08);border-radius:12px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,.5);min-width:160px}',
    '.auth-dd-email{padding:10px 16px;font-size:12px;color:rgba(255,255,255,.35);border-bottom:1px solid rgba(255,255,255,.06);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.auth-dd-item{display:block;width:100%;padding:10px 16px;background:none;border:none;color:rgba(255,255,255,.65);font-size:13px;text-align:left;cursor:pointer;font-family:inherit;transition:background .15s}',
    '.auth-dd-item:hover{background:rgba(255,255,255,.05);color:#f87171}',
    '@media(min-width:481px){.auth-overlay{align-items:center}.auth-sheet{border-radius:20px;margin-bottom:20px;max-width:420px}}'
  ].join('\n');
  document.head.appendChild(style);
}

/* ── Init ── */
injectStyles();
refresh();

/* Expose */
window.Auth = {
  refresh: refresh,
  isLoggedIn: isLoggedIn,
  getUserId: getUserId,
  getEmail: getEmail,
  getUser: getUser,
  onAuthChange: onAuthChange,
  requestLogin: requestLogin,
  logout: logout,
  showLoginModal: showLoginModal
};

})();
