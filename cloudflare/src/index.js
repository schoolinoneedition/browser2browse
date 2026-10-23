import { DurableObject } from 'cloudflare:workers';

const SESSION_MS = 7 * 60 * 1000;
const MAX_BODY = 8192;
const text = (value, status = 200, headers = {}) => new Response(value, { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers } });
const json = (value, status = 200, headers = {}) => text(JSON.stringify(value), status, headers);
const encoder = new TextEncoder();
const digest = async value => new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
const hex = bytes => [...bytes].map(x => x.toString(16).padStart(2, '0')).join('');

function cors(request, env) {
  const origin = request.headers.get('Origin');
  if (origin !== env.ALLOWED_ORIGIN) return null;
  return { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS', 'access-control-allow-headers': 'authorization,content-type', 'access-control-max-age': '600', vary: 'Origin' };
}

function v4Public(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some(x => !Number.isInteger(x) || x < 0 || x > 255)) return false;
  const [a, b, c] = p;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) || (a === 192 && b === 0 && c === 2) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
}

function v6Public(ip) {
  const x = ip.toLowerCase().split('%')[0];
  if (!x.includes(':')) return v4Public(x);
  if (x === '::' || x === '::1' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe8') || x.startsWith('fe9') || x.startsWith('fea') || x.startsWith('feb') || x.startsWith('ff') || x.startsWith('2001:db8:')) return false;
  if (x.startsWith('::ffff:')) return v4Public(x.slice(7).replace(/^\[|\]$/g, ''));
  return true;
}

function safeHostShape(host) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') ||
      h.endsWith('.home.arpa') || h === 'metadata.google.internal' || h === 'metadata' || h === 'instance-data' ||
      h === 'host.docker.internal' || h === 'kubernetes.default.svc' || h === '169.254.169.254' ||
      h === '100.100.100.200' || h === 'metadata.tencentyun.com' || h === 'fd00:ec2::254') return false;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(h) || h.includes(':')) return false;
  return true;
}

async function publicHostname(host) {
  if (!safeHostShape(host)) return false;
  const answers = [];
  for (const type of ['A', 'AAAA']) {
    try {
      const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(2500) });
      if (!response.ok) continue;
      const result = await response.json();
      for (const record of result.Answer || []) if (record.type === (type === 'A' ? 1 : 28)) answers.push(record.data);
    } catch {}
  }
  return answers.length > 0 && answers.every(ip => ip.includes(':') ? v6Public(ip) : v4Public(ip));
}

function publicUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Enter a valid web address.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || !safeHostShape(url.hostname)) throw new Error('Only public HTTP and HTTPS websites can be opened.');
  return url.href;
}

async function readJson(request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY) throw new Error('Request body is too large.');
  return raw ? JSON.parse(raw) : {};
}

function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, Math.min(i + 0x8000, bytes.length)));
  return btoa(s);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/healthz' && request.method === 'GET') return json({ ok: true, runtime: 'cloudflare-browser-run' });
    const headers = cors(request, env);
    if (!headers) return json({ error: 'Origin not allowed.' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });

    try {
      if (url.pathname === '/api/sessions' && request.method === 'POST') {
        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        const gate = env.BROWSER_SESSION.getByName('admission-control');
        const admission = await gate.fetch('https://session.internal/admit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ip }) });
        if (!admission.ok) return json(await admission.json(), admission.status, headers);
        const id = crypto.randomUUID();
        const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
        const token = b64(tokenBytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        const stub = env.BROWSER_SESSION.getByName(id);
        const started = await stub.fetch('https://session.internal/init', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
        if (!started.ok) return json(await started.json(), started.status, headers);
        return json({ ...(await started.json()), id, token }, 201, headers);
      }

      if (url.pathname === '/stream' && request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
        const id = url.searchParams.get('sessionId');
        if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'Invalid session.' }, 400, headers);
        const stub = env.BROWSER_SESSION.getByName(id);
        const forwarded = new Request('https://session.internal/stream', request);
        const response = await stub.fetch(forwarded);
        const outHeaders = new Headers(response.headers);
        for (const [key, value] of Object.entries(headers)) outHeaders.set(key, value);
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers: outHeaders, webSocket: response.webSocket });
      }

      const match = /^\/api\/sessions\/([0-9a-f-]{36})(\/.*)?$/i.exec(url.pathname);
      if (!match) return json({ error: 'Not found.' }, 404, headers);
      const target = env.BROWSER_SESSION.getByName(match[1]);
      const forwarded = new Request(`https://session.internal${match[2] || '/session'}`, request);
      const response = await target.fetch(forwarded);
      const outHeaders = new Headers(response.headers);
      for (const [key, value] of Object.entries(headers)) outHeaders.set(key, value);
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers: outHeaders, webSocket: response.webSocket });
    } catch (error) {
      console.log(JSON.stringify({ event: 'request_failed', path: url.pathname, error: String(error?.message || error).slice(0, 180) }));
      return json({ error: error?.message || 'The remote browser request failed.' }, 400, headers);
    }
  }
};

export class BrowserSession extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.connection = null;
    this.cdp = null;
    this.pending = new Map();
    this.nextCommandId = 1;
    this.tabs = new Map();
    this.peers = new Set();
    this.activeTabId = null;
    this.tokenHash = null;
    this.dnsCache = new Map();
  }

  async fetch(request) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/admit' && request.method === 'POST') return this.admit(await readJson(request));
      if (url.pathname === '/init' && request.method === 'POST') return this.init(await readJson(request));
      if (url.pathname === '/stream' && request.headers.get('Upgrade')?.toLowerCase() === 'websocket') return this.upgrade();
      if (!await this.authorized(request)) return json({ error: 'Remote session expired. Start a new session.' }, 401);
      if (url.pathname === '/session' && request.method === 'DELETE') {
        for (const peer of this.peers) if (peer.readyState === WebSocket.OPEN) peer.close(4408, 'Session closed');
        const browserRunId = this.connection?.sessionId || await this.ctx.storage.get('browserRunId');
        if (browserRunId) await this.env.BROWSER.closeSession(browserRunId).catch(() => {});
        this.connection = null; this.cdp?.close(); this.cdp = null; this.tabs.clear(); this.peers.clear(); this.tokenHash = null; this.activeTabId = null;
        await this.ctx.storage.deleteAll();
        return json({ ok: true });
      }
      await this.ensureConnection();
      if (url.pathname.endsWith('/tabs') && request.method === 'POST') {
        const body = await readJson(request);
        const tab = await this.createTab();
        if (body.url) await this.navigate(tab, body.url);
        await this.activate(tab.id);
        return json({ tab: await this.snapshot(tab) }, 201);
      }
      const action = /^\/tabs\/([^/]+)(?:\/(navigate|back|forward|reload))?$/.exec(url.pathname);
      if (action) {
        const tab = this.tabs.get(decodeURIComponent(action[1]));
        if (!tab) return json({ error: 'That browser tab is no longer available.' }, 404);
        if (!action[2] && request.method === 'DELETE') {
          await this.command('Target.closeTarget', { targetId: tab.targetId });
          this.tabs.delete(tab.id);
          if (this.activeTabId === tab.id) {
            this.activeTabId = this.tabs.keys().next().value || null;
            if (this.activeTabId) await this.activate(this.activeTabId);
          }
          return json({ ok: true });
        }
        if (action[2] === 'navigate' && request.method === 'POST') {
          const body = await readJson(request);
          await this.navigate(tab, body.url);
          return json({ tab: await this.snapshot(tab) });
        }
        if (['back', 'forward', 'reload'].includes(action[2]) && request.method === 'POST') {
          if (action[2] === 'back') await this.pageCommand(tab, 'Page.navigateToHistoryEntry', await this.historyTarget(tab, -1));
          else if (action[2] === 'forward') await this.pageCommand(tab, 'Page.navigateToHistoryEntry', await this.historyTarget(tab, 1));
          else await this.pageCommand(tab, 'Page.reload', { ignoreCache: false });
          await this.emitState(tab);
          return json({ tab: await this.snapshot(tab) });
        }
      }
      return json({ error: 'Not found.' }, 404);
    } catch (error) {
      console.log(JSON.stringify({ event: 'session_request_failed', error: String(error?.message || error).slice(0, 180) }));
      return json({ error: error?.message || 'Remote browser request failed.' }, 400);
    }
  }

  async admit({ ip }) {
    const day = new Date().toISOString().slice(0, 10);
    const key = `admission:${hex(await digest(String(ip || 'unknown')))}`;
    const old = await this.ctx.storage.get(key);
    const count = old?.day === day ? old.count : 0;
    if (count >= 3) return json({ error: 'Daily free browser limit reached from this network. Try again tomorrow.' }, 429);
    await this.ctx.storage.put(key, { day, count: count + 1 }, { expirationTtl: 172800 });
    return json({ ok: true });
  }

  async init({ token }) {
    if (typeof token !== 'string' || token.length < 40) return json({ error: 'Invalid session token.' }, 400);
    if (this.connection) return json({ error: 'Session already started.' }, 409);
    this.tokenHash = await digest(token);
    await this.ctx.storage.put('tokenHash', hex(this.tokenHash), { expirationTtl: SESSION_MS / 1000 });
    try {
      this.connection = await this.env.BROWSER.acquire({ keepAlive: SESSION_MS, targets: true, guardrails: { allowedDomains: ['*'], allowedDomainSets: ['common-cdns'] } });
      await this.ctx.storage.put('browserRunId', this.connection.sessionId, { expirationTtl: SESSION_MS / 1000 });
      await this.connectSocket();
      const tab = await this.createTab();
      this.activeTabId = tab.id;
      await this.activate(tab.id);
      return json({ activeTabId: tab.id, tabs: [await this.snapshot(tab)] });
    } catch (error) {
      console.log(JSON.stringify({ event: 'browser_start_failed', error: String(error?.message || error).slice(0, 180) }));
      return json({ error: 'Cloud browser could not start. Check the Cloudflare Browser Run binding and free daily allowance.' }, 503);
    }
  }

  async ensureConnection() {
    if (this.cdp?.readyState === WebSocket.OPEN) return;
    const id = this.connection?.sessionId || await this.ctx.storage.get('browserRunId');
    if (!id) throw new Error('Browser session expired. Start a new session.');
    this.connection = await this.env.BROWSER.connectSession(id);
    await this.connectSocket();
  }

  async connectSocket() {
    const response = await this.connection.webSocket.fetch('https://browser-binding.invalid', { headers: { Upgrade: 'websocket' } });
    if (!response.webSocket) throw new Error('Cloudflare Browser Run did not open a DevTools connection.');
    this.cdp = response.webSocket;
    this.cdp.accept();
    this.cdp.addEventListener('message', event => this.onCdpMessage(event).catch(() => {}));
    this.cdp.addEventListener('close', () => {
      this.cdp = null;
      for (const p of this.pending.values()) p.reject(new Error('Browser connection closed.'));
      this.pending.clear();
      for (const peer of this.peers) if (peer.readyState === WebSocket.OPEN) peer.close(4408, 'Browser session expired');
    });
  }

  async command(method, params = {}, sessionId) {
    if (!this.cdp || this.cdp.readyState !== WebSocket.OPEN) throw new Error('Browser connection is not available.');
    const id = this.nextCommandId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Browser command timed out: ${method}`)); }, 15000);
      this.pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
      try { this.cdp.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  async onCdpMessage(event) {
    let message;
    try { message = JSON.parse(typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data)); } catch { return; }
    if (message.id && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id); this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result || {});
      return;
    }
    const tab = [...this.tabs.values()].find(t => t.sessionId === message.sessionId);
    if (!tab) return;
    if (message.method === 'Page.screencastFrame') {
      const { sessionId, data } = message.params;
      const frame = JSON.stringify({ type: 'frame', tabId: tab.id, data });
      for (const peer of this.peers) if (peer.readyState === WebSocket.OPEN) peer.send(frame);
      this.command('Page.screencastFrameAck', { sessionId }, tab.sessionId).catch(() => {});
    } else if (message.method === 'Page.frameNavigated' && !message.params.frame.parentId) {
      this.emitState(tab, false).catch(() => {});
    } else if (message.method === 'Page.loadEventFired') {
      this.emitState(tab, true).catch(() => {});
    } else if (message.method === 'Fetch.requestPaused') {
      this.checkAndContinue({ ...message.params, sessionId: message.sessionId }).catch(() => this.command('Fetch.failRequest', { requestId: message.params.requestId, errorReason: 'BlockedByClient' }, message.sessionId).catch(() => {}));
    }
  }

  async checkAndContinue(request) {
    const requestId = request.requestId;
    try {
      const u = new URL(request.request.url);
      if (!['http:', 'https:'].includes(u.protocol) || !await this.publicHostCached(u.hostname)) throw new Error('Blocked destination.');
      await this.command('Fetch.continueRequest', { requestId }, request.sessionId);
    } catch {
      await this.command('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }, request.sessionId).catch(() => {});
    }
  }

  async publicHostCached(host) {
    const key = host.toLowerCase();
    const cached = this.dnsCache.get(key);
    if (cached && cached.until > Date.now()) return cached.ok;
    const ok = await publicHostname(key);
    this.dnsCache.set(key, { ok, until: Date.now() + 30000 });
    return ok;
  }

  async createTab() {
    const result = await this.command('Target.createTarget', { url: 'about:blank' });
    const info = await this.command('Target.attachToTarget', { targetId: result.targetId, flatten: true });
    const tab = { id: result.targetId, targetId: result.targetId, sessionId: info.sessionId, url: '', title: 'New tab', loading: false, canGoBack: false, canGoForward: false };
    this.tabs.set(tab.id, tab);
    await this.pageCommand(tab, 'Page.enable');
    await this.pageCommand(tab, 'Network.enable');
    await this.pageCommand(tab, 'Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
    return tab;
  }

  async attachTarget(info) {
    if ([...this.tabs.values()].some(t => t.targetId === info.targetId)) return;
    const attached = await this.command('Target.attachToTarget', { targetId: info.targetId, flatten: true });
    const tab = { id: info.targetId, targetId: info.targetId, sessionId: attached.sessionId, url: info.url || '', title: info.title || 'New tab', loading: false, canGoBack: false, canGoForward: false };
    this.tabs.set(tab.id, tab);
    await this.pageCommand(tab, 'Page.enable'); await this.pageCommand(tab, 'Network.enable'); await this.pageCommand(tab, 'Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
    await this.activate(tab.id);
  }

  pageCommand(tab, method, params = {}) { return this.command(method, params, tab.sessionId); }

  async navigate(tab, value) {
    const url = publicUrl(value);
    if (!await this.publicHostCached(new URL(url).hostname)) throw new Error('Private, local, or unresolved network destinations are blocked.');
    tab.loading = true; tab.url = url; this.emitState(tab);
    const result = await this.pageCommand(tab, 'Page.navigate', { url });
    if (result.errorText) {
      tab.loading = false;
      await this.emitState(tab, true);
      throw new Error('The website could not be reached from the remote browser. Check the address and try again.');
    }
  }

  async historyTarget(tab, delta) {
    const history = await this.pageCommand(tab, 'Page.getNavigationHistory');
    const index = history.currentIndex + delta;
    if (index < 0 || index >= history.entries.length) throw new Error('There is no page in that direction.');
    return { entryId: history.entries[index].id };
  }

  async activate(id) {
    const tab = this.tabs.get(id); if (!tab) return;
    const previous = this.tabs.get(this.activeTabId);
    if (previous && previous.id !== tab.id) await this.pageCommand(previous, 'Page.stopScreencast').catch(() => {});
    this.activeTabId = tab.id;
    await this.pageCommand(tab, 'Page.startScreencast', { format: 'jpeg', quality: 68, maxWidth: 1600, maxHeight: 1000, everyNthFrame: 1 });
    await this.emitState(tab);
  }

  async snapshot(tab) {
    const info = await this.command('Target.getTargetInfo', { targetId: tab.targetId }).catch(() => ({ targetInfo: {} }));
    await this.emitState(tab).catch(() => {});
    return { id: tab.id, url: info.targetInfo?.url === 'about:blank' ? '' : info.targetInfo?.url || tab.url, title: info.targetInfo?.title || tab.title, loading: tab.loading, canGoBack: tab.canGoBack, canGoForward: tab.canGoForward };
  }

  async emitState(tab, settled = false) {
    const info = await this.command('Target.getTargetInfo', { targetId: tab.targetId }).catch(() => ({ targetInfo: {} }));
    const data = info.targetInfo || {};
    tab.url = data.url === 'about:blank' ? '' : data.url || tab.url;
    tab.title = data.title || (tab.url ? new URL(tab.url).hostname : 'New tab');
    const history = await this.pageCommand(tab, 'Page.getNavigationHistory').catch(() => ({ currentIndex: 0, entries: [] }));
    tab.canGoBack = history.currentIndex > 0;
    tab.canGoForward = history.currentIndex < history.entries.length - 1;
    if (settled) tab.loading = false;
    const message = JSON.stringify({ type: 'state', tabId: tab.id, url: tab.url, title: tab.title, loading: tab.loading, canGoBack: tab.canGoBack, canGoForward: tab.canGoForward });
    for (const peer of this.peers) if (peer.readyState === WebSocket.OPEN) peer.send(message);
  }

  async authorized(request) {
    const match = /^Bearer ([A-Za-z0-9_-]{40,})$/.exec(request.headers.get('Authorization') || '');
    if (!match) return false;
    if (!this.tokenHash) {
      const stored = await this.ctx.storage.get('tokenHash');
      if (stored) this.tokenHash = Uint8Array.from(stored.match(/.{2}/g).map(x => parseInt(x, 16)));
    }
    if (!this.tokenHash) return false;
    const got = await digest(match[1]);
    return got.length === this.tokenHash.length && got.every((byte, i) => byte === this.tokenHash[i]);
  }

  upgrade() {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    let authenticated = false;
    const timer = setTimeout(() => { if (!authenticated) server.close(4401, 'Authenticate'); }, 5000);
    server.addEventListener('message', async event => {
      try {
        const message = JSON.parse(typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data));
        if (!authenticated) {
          if (message.type !== 'auth' || !await this.authorized(new Request('https://session.internal/', { headers: { authorization: `Bearer ${message.token || ''}` } }))) { server.close(4401, 'Invalid session'); return; }
          authenticated = true; clearTimeout(timer); this.peers.add(server);
          const tabs = await Promise.all([...this.tabs.values()].map(tab => this.snapshot(tab)));
          server.send(JSON.stringify({ type: 'ready', tabs, activeTabId: this.activeTabId }));
          if (this.activeTabId) await this.activate(this.activeTabId);
          return;
        }
        const tab = this.tabs.get(message.tabId);
        if (!tab) return;
        if (message.type === 'activate') { await this.activate(tab.id); return; }
        if (message.type === 'input') {
          const xy = { x: Math.max(0, Number(message.x) || 0), y: Math.max(0, Number(message.y) || 0) };
          if (message.event === 'wheel') await this.pageCommand(tab, 'Input.dispatchMouseEvent', { type: 'mouseWheel', ...xy, deltaX: Number(message.deltaX) || 0, deltaY: Number(message.deltaY) || 0 });
          else if (['mouseMoved', 'mousePressed', 'mouseReleased'].includes(message.event)) await this.pageCommand(tab, 'Input.dispatchMouseEvent', { type: message.event, ...xy, button: message.button === 2 ? 'right' : message.button === 1 ? 'middle' : 'left', clickCount: 1 });
        } else if (message.type === 'key') {
          const m = message.modifiers || {}, modifiers = (m.alt ? 1 : 0) | (m.ctrl ? 2 : 0) | (m.meta ? 4 : 0) | (m.shift ? 8 : 0);
          if (!modifiers && message.key?.length === 1) await this.pageCommand(tab, 'Input.insertText', { text: message.key });
          else { await this.pageCommand(tab, 'Input.dispatchKeyEvent', { type: 'keyDown', key: message.key, code: message.code, modifiers }); await this.pageCommand(tab, 'Input.dispatchKeyEvent', { type: 'keyUp', key: message.key, code: message.code, modifiers }); }
        } else if (message.type === 'type') await this.pageCommand(tab, 'Input.insertText', { text: String(message.text || '').slice(0, 1000) });
        else if (message.type === 'resize') await this.pageCommand(tab, 'Emulation.setDeviceMetricsOverride', { width: Math.max(320, Math.min(1920, Number(message.width) || 1280)), height: Math.max(240, Math.min(1200, Number(message.height) || 800)), deviceScaleFactor: 1, mobile: false });
      } catch {}
    });
    server.addEventListener('close', () => { clearTimeout(timer); this.peers.delete(server); });
    return new Response(null, { status: 101, webSocket: client, headers: { 'cache-control': 'no-store' } });
  }
}

