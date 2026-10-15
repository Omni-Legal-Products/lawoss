// Installed before Arborist or any SDK import. This is a Node socket guard, not an OS firewall.
import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns';
import dgram from 'node:dgram';
import { syncBuiltinESMExports } from 'node:module';
Object.defineProperty(globalThis, Symbol.for('lawoss.payload.networkDisabled'), { value: true, configurable: false });
const deny = () => { throw Object.assign(new Error('NETWORK_DISABLED'), { code: 'NETWORK_DISABLED' }); };
net.Socket.prototype.connect = deny;
net.connect = net.createConnection = tls.connect = deny;
dgram.createSocket = deny;
for (const key of Object.keys(dns)) if (/^(?:lookup|resolve|reverse)/.test(key) && typeof dns[key] === 'function') dns[key] = deny;
for (const key of Object.keys(dns.promises)) if (/^(?:lookup|resolve|reverse)/.test(key) && typeof dns.promises[key] === 'function') dns.promises[key] = deny;
for (const prototype of [dns.Resolver.prototype, dns.promises.Resolver.prototype]) {
  for (const key of Object.getOwnPropertyNames(prototype)) if (/^(?:resolve|reverse)/.test(key)) prototype[key] = deny;
}
syncBuiltinESMExports();
