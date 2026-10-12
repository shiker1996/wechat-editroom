import { execFileSync } from 'node:child_process';

const SYSTEM_PROXY_SCRIPT = String.raw`
$webProxy = [System.Net.WebRequest]::DefaultWebProxy
function Get-SelectedProxy([string]$targetText) {
  $target = [uri]$targetText
  if ($webProxy.IsBypassed($target)) { return '' }
  $proxy = $webProxy.GetProxy($target)
  if ($null -eq $proxy) { return '' }
  return $proxy.AbsoluteUri
}
[pscustomobject]@{
  http = Get-SelectedProxy 'http://huggingface.co/'
  https = Get-SelectedProxy 'https://huggingface.co/'
} | ConvertTo-Json -Compress
`;

function hasProxyEnvironment(env) {
  return Boolean(env.HTTP_PROXY || env.http_proxy || env.HTTPS_PROXY || env.https_proxy);
}

function bypassLoopbackHosts(env) {
  const entries = [...String(env.NO_PROXY || '').split(','), ...String(env.no_proxy || '').split(',')]
    .map((entry) => entry.trim())
    .filter(Boolean);
  const seen = new Set(entries.map((entry) => entry.toLowerCase()));
  for (const host of ['localhost', '127.0.0.1', '::1']) {
    if (!seen.has(host)) entries.push(host);
  }
  const value = entries.join(',');
  env.NO_PROXY = value;
  env.no_proxy = value;
}

function validProxy(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const proxy = new URL(value.trim());
    return ['http:', 'https:'].includes(proxy.protocol) && proxy.hostname ? proxy.href : '';
  } catch {
    return '';
  }
}

function discoverWindowsProxy() {
  try {
    const output = execFileSync('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', SYSTEM_PROXY_SCRIPT,
    ], { encoding: 'utf8', timeout: 4000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const result = JSON.parse(output.trim());
    return { http: validProxy(result.http), https: validProxy(result.https) };
  } catch {
    return { http: '', https: '' };
  }
}

export function nodeProxyEnvironment(source = process.env, platform = process.platform) {
  const env = { ...source };
  if (!hasProxyEnvironment(env) && platform === 'win32') {
    const systemProxy = discoverWindowsProxy();
    if (systemProxy.http) env.HTTP_PROXY = systemProxy.http;
    if (systemProxy.https) env.HTTPS_PROXY = systemProxy.https;
  }
  if (hasProxyEnvironment(env) && env.NODE_USE_ENV_PROXY !== '0') {
    bypassLoopbackHosts(env);
    env.NODE_USE_ENV_PROXY = '1';
  }
  return env;
}
