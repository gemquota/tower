// Monkey-patch Node.js DNS to resolve api.vercel.com via our custom resolver
const dns = require('dns');
const net = require('net');

const OVERRIDES = {
  'api.vercel.com': '76.76.21.112',
  'vercel.com': '64.239.123.65',
};

const originalLookup = dns.lookup;
dns.lookup = function(hostname, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  if (OVERRIDES[hostname]) {
    const ip = OVERRIDES[hostname];
    const family = net.isIPv4(ip) ? 4 : 6;
    if (callback) {
      callback(null, ip, family);
    }
    return;
  }
  originalLookup.call(dns, hostname, options, callback);
};

const originalResolve4 = dns.resolve4;
dns.resolve4 = function(hostname, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  if (OVERRIDES[hostname]) {
    if (callback) callback(null, [OVERRIDES[hostname]]);
    return;
  }
  originalResolve4.call(dns, hostname, options, callback);
};

const originalResolve = dns.resolve;
dns.resolve = function(hostname, rrtype, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  if (OVERRIDES[hostname] && (!rrtype || rrtype === 'A' || rrtype === 'ANY')) {
    if (callback) callback(null, [OVERRIDES[hostname]]);
    return;
  }
  originalResolve.call(dns, hostname, rrtype, options, callback);
};

// Now run the vercel deploy command
const { spawn } = require('child_process');
const args = ['deploy', '--prod', '--yes', ...process.argv.slice(2)];
const child = spawn('/data/data/com.termux/files/usr/bin/vercel', args, {
  cwd: '/data/data/com.termux/files/home/dev/codex/games/tower',
  stdio: 'inherit',
  env: { ...process.env, NODE_OPTIONS: '' }
});

child.on('exit', (code) => {
  process.exit(code);
});
