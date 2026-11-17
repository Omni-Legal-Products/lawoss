// Only a short-lived device user code leaves the runner, encrypted to an operator-owned key.
import { constants, createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, generateKeyPairSync, privateDecrypt, publicEncrypt, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function recipientKey(encoded) {
  if (typeof encoded !== 'string' || encoded.length > 4096 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('Invalid recipient public key');
  const key = createPublicKey({ key: Buffer.from(encoded, 'base64'), type: 'spki', format: 'der' });
  if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < 3072) throw new Error('Use an RSA public key of at least 3072 bits');
  return key;
}

function deviceChallenge(value) {
  if (!value || typeof value !== 'object' || Object.keys(value).sort().join() !== 'code,expiresAt,model,platform,run,sha,url'
    || value.url !== 'https://auth.openai.com/codex/device' || !/^[A-Za-z0-9-]{4,32}$/.test(value.code)
    || !Number.isSafeInteger(value.expiresAt) || !/^[a-z0-9.-]{1,80}$/.test(value.model)
    || !['macos-15', 'windows-2022', 'windows-11-arm'].includes(value.platform)
    || !/^\d+-\d+$/.test(value.run) || !/^[a-f0-9]{40}$/.test(value.sha)) throw new Error('Invalid device challenge');
  return value;
}

export function encryptChallenge(value, publicKey) {
  const payload = deviceChallenge(value);
  const key = recipientKey(publicKey);
  const secret = randomBytes(32), iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', secret, iv);
  cipher.setAAD(Buffer.from('lawoss-chatgpt-device-v1'));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final()]);
  return { version: 1, algorithm: 'RSA-OAEP-SHA256+A256GCM',
    fingerprint: createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex'),
    wrappedKey: publicEncrypt({ key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, secret).toString('base64'),
    iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
}

export function decryptChallenge(envelope, privateKey, passphrase) {
  if (!envelope || envelope.version !== 1 || envelope.algorithm !== 'RSA-OAEP-SHA256+A256GCM') throw new Error('Unsupported challenge envelope');
  for (const key of ['wrappedKey', 'iv', 'tag', 'ciphertext']) {
    if (typeof envelope[key] !== 'string' || envelope[key].length > 8192 || !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope[key])) throw new Error('Invalid challenge envelope');
  }
  if (Buffer.from(envelope.iv, 'base64').length !== 12 || Buffer.from(envelope.tag, 'base64').length !== 16) throw new Error('Invalid GCM parameters');
  const key = createPrivateKey({ key: privateKey, passphrase });
  const secret = privateDecrypt({ key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(envelope.wrappedKey, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', secret, Buffer.from(envelope.iv, 'base64'));
  decipher.setAAD(Buffer.from('lawoss-chatgpt-device-v1'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  return deviceChallenge(JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]).toString('utf8')));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [command, filename, privateFile] = process.argv.slice(2);
    const passphrase = process.env.CHATGPT_KEY_PASSPHRASE;
    if (!passphrase || passphrase.length < 16) throw new Error('Set CHATGPT_KEY_PASSPHRASE to a local passphrase of at least 16 characters');
    if (command === 'keygen' && filename && !privateFile) {
      const directory = path.resolve(filename);
      const pair = generateKeyPairSync('rsa', { modulusLength: 3072 });
      await mkdir(directory, { mode: 0o700 });
      await writeFile(path.join(directory, 'private.pem'), pair.privateKey.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase }), { flag: 'wx', mode: 0o600 });
      const publicKey = pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
      await writeFile(path.join(directory, 'public.txt'), publicKey, { flag: 'wx', mode: 0o644 });
      console.log(publicKey);
    } else if (command === 'decrypt' && filename && privateFile) {
      const content = await readFile(filename, 'utf8');
      if (content.length > 20_000) throw new Error('Oversized challenge');
      const challenge = decryptChallenge(JSON.parse(content), await readFile(privateFile, 'utf8'), passphrase);
      if (challenge.expiresAt <= Date.now()) throw new Error('Device challenge has expired');
      // Run locally, never in GitHub Actions: the code authorizes the specific runner's login.
      if (process.env.GITHUB_ACTIONS === 'true') throw new Error('Decrypt only on the operator computer');
      console.log(JSON.stringify(challenge, null, 2));
    } else throw new Error('Usage: challenge.mjs keygen <NEW-directory> | decrypt <challenge.json> <private.pem>');
  } catch {
    console.error('Challenge operation failed; check command, local passphrase, key, expiry and envelope.');
    process.exitCode = 1;
  }
}
