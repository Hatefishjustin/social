/**
 * 真实权限测试：验证 /askbox/visibility 的 403 防护
 * 
 * 测试场景：
 * 用户A登录 → 尝试 POST /askbox/visibility 修改用户B的问题 → 预期 403
 * 
 * 使用方法：
 * 1. 确保 wrangler pages dev 在运行 (http://localhost:8788)
 * 2. 确保本地 D1 数据库有至少两个不同用户
 * 3. 执行: node test-visibility-auth.js
 */

const BASE = 'http://localhost:8788';

async function login(email, password) {
  const res = await fetch(`${BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    redirect: 'manual'
  });
  const cookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const cookieStr = cookies.join('; ');
  console.log(`   登录 ${email}:`, res.status, cookieStr ? 'Cookie OK' : 'No Cookie');
  return { cookie: cookieStr, status: res.status };
}

async function getProfile(cookie) {
  const res = await fetch(`${BASE}/api/profile`, {
    headers: { 'Cookie': cookie }
  });
  return await res.json();
}

async function askQuestion(cookie, targetId, content) {
  const res = await fetch(`${BASE}/askbox`, {
    method: 'POST',
    headers: { 'Cookie': cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetId, content })
  });
  return { data: await res.json(), status: res.status };
}

async function getQuestions(cookie, targetId) {
  const res = await fetch(`${BASE}/askbox?targetId=${targetId}`, {
    headers: { 'Cookie': cookie }
  });
  return await res.json();
}

async function answerQuestion(cookie, questionId, answerContent) {
  const res = await fetch(`${BASE}/askbox/answer`, {
    method: 'POST',
    headers: { 'Cookie': cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ questionId, answerContent })
  });
  return { data: await res.json(), status: res.status };
}

async function toggleVisibility(cookie, questionId, answerVisibility) {
  const res = await fetch(`${BASE}/askbox/visibility`, {
    method: 'POST',
    headers: { 'Cookie': cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ questionId, answerVisibility })
  });
  return { data: await res.json(), status: res.status };
}

async function main() {
  console.log('========================================');
  console.log(' 提问箱回复隐私控制 - 真实权限测试');
  console.log('========================================\n');

  const TEST_A = { email: 'test@test.com', password: 'test123456' };
  const TEST_B = { email: 'test4@test.com', password: 'test123456' };

  // 1. 登录用户 A
  console.log('1. 登录测试用户 A...');
  const { cookie: cookieA } = await login(TEST_A.email, TEST_A.password);
  if (!cookieA) {
    console.log('   ❌ 用户 A 登录失败，跳过');
    return;
  }
  const profileA = await getProfile(cookieA);
  console.log('   用户 A ID:', profileA.id);

  // 2. 登录用户 B
  console.log('\n2. 登录测试用户 B...');
  const { cookie: cookieB } = await login(TEST_B.email, TEST_B.password);
  if (!cookieB) {
    console.log('   ❌ 用户 B 登录失败，跳过');
    return;
  }
  const profileB = await getProfile(cookieB);
  console.log('   用户 B ID:', profileB.id);

  // 3. 用户 A 向用户 B 提问
  console.log('\n3. 用户 A 向用户 B 提问...');
  const q = await askQuestion(cookieA, profileB.id, 'Test question ' + Date.now());
  console.log('   状态:', q.status, JSON.stringify(q.data));
  if (q.status !== 200 || !q.data.ok) {
    console.log('   ❌ 提问失败');
    return;
  }
  const qid = q.data.id;
  console.log('   问题 ID:', qid);

  // 4. 用户 B 回答
  console.log('\n4. 用户 B 回答...');
  const a = await answerQuestion(cookieB, qid, 'Test answer ' + Date.now());
  console.log('   状态:', a.status, JSON.stringify(a.data));
  if (a.status !== 200) {
    console.log('   ❌ 回答失败');
    return;
  }

  // 5. 用户A修改用户B的问题 → 预期 403
  console.log('\n5. ⚠️ 用户 A 修改用户 B 问题的可见性（预期 403）...');
  const v = await toggleVisibility(cookieA, qid, 'private');
  console.log('   状态:', v.status, '结果:', JSON.stringify(v.data));
  if (v.status === 403) {
    console.log('   ✅ 通过！403 forbidden');
  } else {
    console.log('   ❌ 失败！预期 403，实际', v.status);
  }

  // 6. 用户B修改自己的问题 → 预期 200
  console.log('\n6. ✅ 用户 B 修改自己问题的可见性为 private...');
  const v2 = await toggleVisibility(cookieB, qid, 'private');
  console.log('   状态:', v2.status, '结果:', JSON.stringify(v2.data));
  if (v2.status === 200 && v2.data.ok) {
    console.log('   ✅ 通过！箱主可以修改');
  } else {
    console.log('   ❌ 失败');
  }

  // 7. 游客验证
  console.log('\n7. 验证游客看不到 private 问题...');
  // 箱主能看到
  const qList = await getQuestions(cookieB, profileB.id);
  console.log('   箱主看到:', qList.questions.find(q => q.id === qid) ? '✅ 有' : '❌ 无');
  // 游客看
  const gRes = await fetch(`${BASE}/askbox?targetId=${profileB.id}`);
  const gList = await gRes.json();
  console.log('   游客看到:', gList.questions.find(q => q.id === qid) ? '❌ 不该看到' : '✅ 看不到');

  // 8. 恢复 public
  console.log('\n8. 用户 B 恢复为 public...');
  const v3 = await toggleVisibility(cookieB, qid, 'public');
  console.log('   状态:', v3.status, JSON.stringify(v3.data));

  // 9. 游客验证恢复可见
  const gRes2 = await fetch(`${BASE}/askbox?targetId=${profileB.id}`);
  const gList2 = await gRes2.json();
  console.log('\n9. 恢复后游客看到:', gList2.questions.find(q => q.id === qid) ? '✅ 可见' : '❌ 不可见');

  console.log('\n========================================');
  console.log(' 测试完成');
  console.log('========================================');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});