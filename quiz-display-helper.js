/**
 * SoulMirror 管理后台 - 心理测评展示辅助函数
 * 路径: /quiz-display-helper.js
 * 用途: 将 quiz_results 的原始数据（国家代码/城市/UA/scores_json/answers_json）渲染为中文运营可读格式
 *
 * 说明: 本文件以普通 script src 引入并定义全局函数（formatLocation/formatDevice/formatScores/formatAnswers 等），
 *       new_admin.html 内联脚本通过全局调用。文件内自带 htmlEscape() 转义，不依赖 external。
 *
 * 数据来源:
 *  - 国家/城市: Cloudflare CF 地理位置（ISO 3166-1 alpha-2 + 英文城市名）
 *  - 测评维度: match.html 内嵌测评的计分结构
 *    scores_json = {
 *      attach: { secure, anxious, avoidant, fearful },
 *      big5: { O, C, E, A, N },
 *      love: { words, acts, gifts, time, touch },
 *      values: { honesty, growth, support, independence, family, stability, present },
 *      mbti: { mbti_E, mbti_I, mbti_N, mbti_S, mbti_F, mbti_T, mbti_P, mbti_J },
 *      gender: { gender_male, gender_female, gender_other, gender_unknown }
 *    }
 *    answers_json = [ { section, multi, choiceIndexes, optionTexts: [...], values } ]
 */

// ==================== 全局 HTML 转义（helper 自包含） ====================
// 注意：转义实体用字符串拼接生成（'&' + 'amp;' 等），避免被解析为 XML/HTML 实体
function htmlEscape(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&' + 'amp;')
    .replace(/</g, '&' + 'lt;')
    .replace(/>/g, '&' + 'gt;')
    .replace(/"/g, '&' + 'quot;');
}

// ==================== 国家代码 → 中文 ====================
var COUNTRY_CN = {
  CN: '中国', US: '美国', JP: '日本', GB: '英国', DE: '德国', FR: '法国',
  KR: '韩国', IN: '印度', BR: '巴西', CA: '加拿大', AU: '澳大利亚',
  IT: '意大利', ES: '西班牙', RU: '俄罗斯', SG: '新加坡', MY: '马来西亚',
  TH: '泰国', VN: '越南', PH: '菲律宾', ID: '印度尼西亚', SA: '沙特阿拉伯',
  AE: '阿联酋', TR: '土耳其', NL: '荷兰', SE: '瑞典', CH: '瑞士',
  NO: '挪威', DK: '丹麦', FI: '芬兰', PL: '波兰', IE: '爱尔兰',
  NZ: '新西兰', AR: '阿根廷', MX: '墨西哥', ZA: '南非', EG: '埃及',
  HK: '中国香港', TW: '中国台湾', MO: '中国澳门'
};

// ==================== 城市英文 → 中文 ====================
var CITY_CN = {
  'Shanghai': '上海', 'Beijing': '北京', 'Guangzhou': '广州', 'Shenzhen': '深圳',
  'Hangzhou': '杭州', 'Chengdu': '成都', 'Wuhan': '武汉', 'Nanjing': '南京',
  'Suzhou': '苏州', "Xi'an": '西安', 'Chongqing': '重庆', 'Tianjin': '天津',
  'Hong Kong': '香港', 'Taipei': '台北', 'Tokyo': '东京', 'Osaka': '大阪',
  'Seoul': '首尔', 'Singapore': '新加坡', 'London': '伦敦', 'Paris': '巴黎',
  'Berlin': '柏林', 'New York': '纽约', 'Los Angeles': '洛杉矶',
  'San Francisco': '旧金山', 'Sydney': '悉尼', 'Melbourne': '墨尔本',
  'Bangkok': '曼谷', 'Dubai': '迪拜', 'Moscow': '莫斯科', 'Toronto': '多伦多',
  'Vancouver': '温哥华', 'Kuala Lumpur': '吉隆坡', 'Jakarta': '雅加达'
};

/**
 * 将 CF 国家代码+城市转换为中文可读地区：'CN Shanghai' → '中国·上海'
 * @param {string} country - ISO 国家代码（如 'CN'）
 * @param {string} city - 英文城市名（如 'Shanghai'）
 * @returns {string}
 */
function formatLocation(country, city) {
  if (!country && !city) return '—';
  var c = COUNTRY_CN[country] || country || '';
  var cl = CITY_CN[city];
  if (!cl && city) {
    cl = city.charAt(0).toUpperCase() + city.slice(1);
  }
  if (c && cl) return c + '·' + cl;
  return c || cl || '—';
}

// ==================== 设备/系统/浏览器 展示 ====================
/**
 * 设备友好名：'iPhone' / 'Android手机' / 'PC' / 'Mac' / '平板'
 * @param {string} device - mobile/desktop/tablet
 * @param {string} os - 解析后的操作系统（含版本，如 'iOS 17.5' / 'Android 14'）
 * @returns {string}
 */
function formatDevice(device, os) {
  if (!device) return '—'; // 旧数据无 device 字段
  var osBase = (os || '').split(' ')[0];
  if (device === 'tablet') return '平板';
  if (device === 'mobile') {
    if (osBase === 'iOS') return 'iPhone';
    if (osBase === 'Android') return 'Android手机';
    return '手机';
  }
  return 'PC';
}

// ==================== 测评维度中文映射 ====================
var QUIZ_ATTACH = {
  secure: { name: '安全型依恋', desc: '你倾向于在亲密关系中感到踏实、信任对方，也信任自己值得被爱。你不容易被短暂的疏离击垮，也能在亲密与独立之间找到平衡。' },
  anxious: { name: '焦虑型依恋', desc: '你对亲密关系投入很深，也格外在意对方的情绪与态度变化，容易在不确定中反复确认"TA是否还爱我"。最适合与情绪稳定、擅长明确表达安全感的伴侣相处。' },
  avoidant: { name: '回避型依恋', desc: '你重视个人空间与独立性，在关系变得过于亲密或有压力时，会本能地想要后退一步。适合你的伴侣通常懂得给你留白，同时又能温和而坚定地邀请你走近。' },
  fearful: { name: '矛盾（恐惧）型依恋', desc: '你内心同时渴望亲密又害怕受伤，常在"想靠近"和"想逃开"之间摇摆。尤其需要一位情绪稳定、有耐心、不会被你的反复吓退的伴侣。' }
};

var QUIZ_LOVE = {
  words: { name: '肯定的言语', desc: '一句真诚的赞美、一句"我懂你的辛苦"，对你而言分量远胜过其他表达方式。语言是你确认爱意最直接的通道。' },
  acts: { name: '服务的行动', desc: '比起言语，你更相信"做了什么"。伴侣默默为你分担、把小事放在心上，是你感受爱意最踏实的方式。' },
  gifts: { name: '精心的礼物', desc: '对你来说，礼物不在贵重，而在于那份被用心记挂的感觉——它是心意具象化的证明。' },
  time: { name: '高质量的陪伴', desc: '专注、不分心的陪伴时光，是你判断一段关系是否被认真对待的核心标准。' },
  touch: { name: '身体的接触', desc: '拥抱、牵手这类身体接触，是你最本能、最直接感知"被爱着"的方式。' }
};

var QUIZ_VALUE = {
  honesty: '诚实坦率', growth: '共同成长', support: '情感支持', independence: '独立空间',
  family: '家庭责任', stability: '稳定安全感', present: '活在当下'
};

var QUIZ_BIG5_FULL = {
  O: '开放性 · 好奇与探索', C: '尽责性 · 自律与可靠', E: '外向性 · 社交与活力',
  A: '宜人性 · 体贴与包容', N: '情绪细腻度 · 敏感与共情'
};

var QUIZ_MBTI = {
  mbti_E: '外向（E）', mbti_I: '内向（I）', mbti_N: '直觉（N）', mbti_S: '实感（S）',
  mbti_F: '情感（F）', mbti_T: '思考（T）', mbti_P: '感知（P）', mbti_J: '计划（J）'
};

var QUIZ_GENDER = {
  gender_male: '男性', gender_female: '女性', gender_other: '非二元/不愿归类', gender_unknown: '未透露'
};

/**
 * 将 scores 对象渲染为中文可读 HTML（维度名 + 归一化分数 + 最高维度结果解释）
 * @param {object} scores - quiz_results.scores_json 解析后的对象
 * @returns {string} HTML 字符串
 */
function formatScores(scores) {
  if (!scores || typeof scores !== 'object' || Object.keys(scores).length === 0) {
    return '<div style="color:var(--muted);">无分数数据</div>';
  }
  var html = '';

  // 依恋类型
  if (scores.attach) {
    var attachEntries = Object.entries(scores.attach).filter(function(e){ return e[1] > 0; });
    var attachTotal = attachEntries.reduce(function(s, e){ return s + Math.max(0, e[1]); }, 0) || 1;
    var topAttach = attachEntries.length ? attachEntries[0][0] : null;
    if (attachEntries.length) {
      html += '<table style="width:100%;border-collapse:collapse;margin-bottom:8px;">' +
        '<thead><tr><th style="text-align:left;padding:6px 8px;">依恋模式</th><th style="text-align:left;padding:6px 8px;">占比</th></tr></thead><tbody>' +
        attachEntries.map(function(e){
          var pct = Math.round(Math.max(0, e[1]) / attachTotal * 100);
          return '<tr><td style="padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.05);">' + htmlEscape((QUIZ_ATTACH[e[0]] || {}).name || e[0]) + '</td>' +
            '<td style="padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.05);">' + pct + '%</td></tr>';
        }).join('') + '</tbody></table>';
      if (topAttach && QUIZ_ATTACH[topAttach]) {
        html += '<div style="background:rgba(196,82,110,.08);border-radius:6px;padding:8px 10px;margin-bottom:12px;">' +
          '<b>' + htmlEscape(QUIZ_ATTACH[topAttach].name) + '</b>：' + htmlEscape(QUIZ_ATTACH[topAttach].desc) + '</div>';
      }
    }
  }

  // 爱之语
  if (scores.love) {
    var loveEntries = Object.entries(scores.love).filter(function(e){ return e[1] > 0; });
    var loveTotal = loveEntries.reduce(function(s, e){ return s + Math.max(0, e[1]); }, 0) || 1;
    var topLove = loveEntries.length ? loveEntries[0][0] : null;
    if (loveEntries.length) {
      html += '<table style="width:100%;border-collapse:collapse;margin-bottom:8px;">' +
        '<thead><tr><th style="text-align:left;padding:6px 8px;">爱的语言</th><th style="text-align:left;padding:6px 8px;">占比</th></tr></thead><tbody>' +
        loveEntries.map(function(e){
          var pct = Math.round(Math.max(0, e[1]) / loveTotal * 100);
          return '<tr><td style="padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.05);">' + htmlEscape((QUIZ_LOVE[e[0]] || {}).name || e[0]) + '</td>' +
            '<td style="padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.05);">' + pct + '%</td></tr>';
        }).join('') + '</tbody></table>';
      if (topLove && QUIZ_LOVE[topLove]) {
        html += '<div style="background:rgba(196,82,110,.08);border-radius:6px;padding:8px 10px;margin-bottom:12px;">' +
          '<b>' + htmlEscape(QUIZ_LOVE[topLove].name) + '</b>：' + htmlEscape(QUIZ_LOVE[topLove].desc) + '</div>';
      }
    }
  }

  // 大五人格
  if (scores.big5) {
    var big5Rows = Object.entries(scores.big5).filter(function(e){ return typeof e[1] === 'number'; });
    if (big5Rows.length) {
      html += '<div style="margin-bottom:12px;"><b style="display:block;margin-bottom:4px;">大五人格</b>' +
        '<table style="width:100%;border-collapse:collapse;">' +
        '<thead><tr><th style="text-align:left;padding:6px 8px;">维度</th><th style="text-align:left;padding:6px 8px;">原始分</th><th style="text-align:left;padding:6px 8px;">常模</th></tr></thead><tbody>' +
        big5Rows.map(function(e){
          var norm = Math.round((e[1] + 10) / 22 * 100);
          norm = Math.max(8, Math.min(96, norm));
          return '<tr><td style="padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.05);">' + htmlEscape(QUIZ_BIG5_FULL[e[0]] || e[0]) + '</td>' +
            '<td style="padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.05);">' + e[1] + '</td>' +
            '<td style="padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.05);">' + norm + '%</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
  }

  // 价值观
  if (scores.values) {
    var valueRows = Object.entries(scores.values).filter(function(e){ return e[1] > 0; })
      .sort(function(a, b){ return b[1] - a[1]; }).slice(0, 6);
    if (valueRows.length) {
      html += '<div style="margin-bottom:12px;"><b style="display:block;margin-bottom:4px;">核心价值观（Top ' + valueRows.length + '）</b>' +
        valueRows.map(function(e){
          return '<div style="padding:3px 8px;border-bottom:1px solid rgba(255,255,255,0.05);">' +
            htmlEscape(QUIZ_VALUE[e[0]] || e[0]) + '：' + Math.round(e[1]) + '</div>';
        }).join('') + '</div>';
    }
  }

  // MBTI 倾向
  if (scores.mbti) {
    var mbtiPairs = [['mbti_E','mbti_I'], ['mbti_N','mbti_S'], ['mbti_F','mbti_T'], ['mbti_P','mbti_J']];
    var mbtiLabel = mbtiPairs.filter(function(p){
      var a = scores.mbti[p[0]] || 0, b = scores.mbti[p[1]] || 0;
      return a > 0 || b > 0;
    }).map(function(p){
      var a = scores.mbti[p[0]] || 0, b = scores.mbti[p[1]] || 0;
      var winner = a >= b ? p[0] : p[1];
      return QUIZ_MBTI[winner] || '';
    }).filter(Boolean).join(' · ');
    if (mbtiLabel) {
      html += '<div style="margin-bottom:12px;"><b style="display:block;margin-bottom:4px;">MBTI 倾向</b>' + htmlEscape(mbtiLabel) + '</div>';
    }
  }

  // 性别
  if (scores.gender) {
    var genderRow = Object.entries(scores.gender).filter(function(e){ return e[1] > 0; });
    if (genderRow.length) {
      html += '<div><b style="display:block;margin-bottom:4px;">性别认同</b>' + htmlEscape(QUIZ_GENDER[genderRow[0][0]] || genderRow[0][0]) + '</div>';
    }
  }

  return html || '<div style="color:var(--muted);">无有效分数数据</div>';
}

/**
 * 将 answers 数组渲染为中文可读 HTML（题目编号 + 用户选择文本）
 * @param {Array} answers - quiz_results.answers_json 解析后的数组（每项含 section/multi/optionTexts）
 * @param {Array} questions - 可选：QUESTIONS 题目定义（若提供则显示题目文本）；缺省仅显示用户选择
 * @returns {string} HTML 字符串
 */
function formatAnswers(answers, questions) {
  if (!Array.isArray(answers) || answers.length === 0) {
    return '<div style="color:var(--muted);">无答题数据</div>';
  }
  var SECTION_NAMES = { M: '背景', A: '依恋', E: 'MBTI', B: '大五', C: '爱之语', D: '价值观' };
  return answers.map(function(a, i){
    if (!a) return '';
    var texts = Array.isArray(a.optionTexts) ? a.optionTexts : [];
    var secName = SECTION_NAMES[a.section] || a.section || '';
    var qText = '';
    if (questions && questions[i] && questions[i].text) {
      qText = '<div style="color:#aaa;font-weight:600;">' + htmlEscape(questions[i].text) + '</div>';
    }
    return '<div style="padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05);">' +
      '<div style="color:var(--muted);font-size:11px;">第 ' + (i + 1) + ' 题' + (secName ? ' · ' + htmlEscape(secName) : '') + (a.multi ? '（多选）' : '（单选）') + '</div>' +
      qText +
      '<div>' + (texts.length ? texts.map(function(t){ return '▪ ' + htmlEscape(t); }).join('<br>') : '<span style="color:var(--muted);">—</span>') + '</div>' +
    '</div>';
  }).join('');
}

/**
 * 设备/系统/浏览器 拼接展示（供列表直接显示）
 * @param {string} device - mobile/desktop/tablet
 * @param {string} os - 操作系统（含版本）
 * @param {string} browser - 浏览器（含版本）
 * @returns {string}
 */
function formatMetaShort(device, os, browser) {
  var dev = formatDevice(device, os);
  // 全部为空（旧数据）→ 显示 —
  if (!device && !os && !browser) return '—';
  var parts = [dev];
  if (os && os !== '未知') parts.push(os);
  if (browser && browser !== '未知') parts.push(browser);
  return parts.join(' · ');
}
