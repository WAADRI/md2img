/**
 * GitHub App 认证工具(无第三方依赖)
 *
 * 用法:
 *   node scripts/github-app-auth.mjs <AppID> <私钥路径> info           # 查看应用与安装信息/权限
 *   node scripts/github-app-auth.mjs <AppID> <私钥路径> token [仓库]   # 输出 installation token
 *
 * 环境变量 GITHUB_API 可覆盖 API 地址;HTTPS_PROXY/ALL_PROXY 自动生效。
 */
import fs from 'node:fs';
import crypto from 'node:crypto';

const API = process.env.GITHUB_API || 'https://api.github.com';

const b64u = (buf) => Buffer.from(buf).toString('base64url');

/** 用 App 私钥生成 RS256 JWT */
function makeJwt(appId, pem) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64u(JSON.stringify({ iat: now - 30, exp: now + 540, iss: String(appId) }));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  signer.end();
  const sig = b64u(signer.sign(pem));
  return `${header}.${payload}.${sig}`;
}

async function api(path, { method = 'GET', token, body } = {}) {
  const resp = await fetch(`${API}${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'md2img-setup',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!resp.ok) {
    const err = new Error(`HTTP ${resp.status} ${method} ${path}: ${typeof data === 'object' ? JSON.stringify(data?.message || data) : String(data).slice(0, 300)}`);
    err.status = resp.status;
    err.data = data;
    throw err;
  }
  return data;
}

const [, , appId, keyPath, cmd, arg] = process.argv;
if (!appId || !keyPath || !cmd) {
  console.error('用法: node scripts/github-app-auth.mjs <AppID> <私钥路径> info|token [仓库]');
  process.exit(1);
}
const pem = fs.readFileSync(keyPath, 'utf8');
const jwt = makeJwt(appId, pem);

if (cmd === 'info') {
  const app = await api('/app', { token: jwt });
  console.log('== 应用信息 ==');
  console.log(JSON.stringify({
    name: app.name,
    slug: app.slug,
    html_url: app.html_url,
    permissions: app.permissions,
  }, null, 2));

  const installs = await api('/app/installations?per_page=100', { token: jwt });
  console.log('\n== 安装列表 ==');
  for (const ins of installs) {
    console.log(JSON.stringify({
      id: ins.id,
      account: ins.account?.login,
      account_type: ins.account?.type,
      repository_selection: ins.repository_selection,
      permissions: ins.permissions,
      suspended: ins.suspended_at ? true : false,
    }, null, 2));
  }
  process.exit(0);
}

if (cmd === 'token') {
  const installs = await api('/app/installations?per_page=100', { token: jwt });
  if (!installs.length) {
    console.error('该应用尚未安装到任何账号/组织 —— 请先在 GitHub 上安装它并授予目标仓库权限');
    process.exit(2);
  }
  // 若传了仓库名(owner/repo),自动选择对应安装
  let ins = installs[0];
  if (arg) {
    const owner = arg.split('/')[0].toLowerCase();
    const found = installs.find((i) => i.account?.login?.toLowerCase() === owner);
    if (!found) {
      console.error(`应用未安装到 ${owner}:可用安装为 ${installs.map((i) => i.account?.login).join(', ')}`);
      process.exit(2);
    }
    ins = found;
  }
  const tok = await api(`/app/installations/${ins.id}/access_tokens`, { method: 'POST', token: jwt });
  console.log(tok.token);
  process.exit(0);
}

console.error('未知命令:', cmd);
process.exit(1);
