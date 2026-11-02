import { spawn } from 'node:child_process';

function runPowerShell(script, value, executable = process.env.POWERSHELL_EXE || 'powershell.exe') {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PSModulePath: `${process.env.SystemRoot || 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\Modules;${process.env.ProgramFiles || 'C:\\Program Files'}\\WindowsPowerShell\\Modules` },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > 2 * 1024 * 1024) child.kill();
    });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr = (stderr + chunk).slice(-4096); });
    child.once('error', reject);
    child.once('close', (code) => code === 0 && stdout.trim()
      ? resolve(stdout.trim())
      : reject(new Error(`Windows DPAPI 操作失败${stderr.trim() ? `：${stderr.trim()}` : ''}`)));
    child.stdin.end(value, 'utf8');
  });
}

const ENCRYPT_SCRIPT = "$ErrorActionPreference='Stop'; Import-Module Microsoft.PowerShell.Security -ErrorAction Stop; $v=[Console]::In.ReadToEnd(); ConvertTo-SecureString -String $v -AsPlainText -Force | ConvertFrom-SecureString";
const DECRYPT_SCRIPT = "$ErrorActionPreference='Stop'; Import-Module Microsoft.PowerShell.Security -ErrorAction Stop; $v=[Console]::In.ReadToEnd(); $s=ConvertTo-SecureString -String $v; $p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($p) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p) }";

export async function protectLocalSecret(value, options = {}) {
  if (process.platform !== 'win32') throw Object.assign(new Error('Codex OAuth 令牌保护目前只支持 Windows DPAPI'), { code: 'SECURE_STORE_UNAVAILABLE' });
  return `dpapi:v1:${await runPowerShell(ENCRYPT_SCRIPT, String(value), options.executable)}`;
}

export async function revealLocalSecret(value, options = {}) {
  const text = String(value || '');
  if (!text.startsWith('dpapi:v1:')) throw Object.assign(new Error('Codex OAuth 凭据格式无效，请重新连接账号'), { code: 'CREDENTIAL_FORMAT_INVALID' });
  if (process.platform !== 'win32') throw Object.assign(new Error('Codex OAuth 令牌保护目前只支持 Windows DPAPI'), { code: 'SECURE_STORE_UNAVAILABLE' });
  return runPowerShell(DECRYPT_SCRIPT, text.slice('dpapi:v1:'.length), options.executable);
}
