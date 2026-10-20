import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { BuildIdentity } from '../src/lawoss/release/build-identity';
import { currentLocale, setLocale } from '../src/i18n';

export function checkMountedBuildIdentity() {
  const locale = currentLocale();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    setLocale('en');
    flushSync(() => root.render(<BuildIdentity build={{ version: '1.2.3', gitSha: 'a'.repeat(40) }} />));
    if (host.querySelector('[role=status]')?.textContent !== 'Build identity unavailable' || host.textContent?.includes('a'.repeat(40))) {
      throw new Error('Missing provenance was not visibly unavailable');
    }
    flushSync(() => root.render(<BuildIdentity build={{ version: '1.2.3', provenance: 'embedded', gitSha: 'b'.repeat(40), os: 'darwin', arch: 'arm64', channel: 'alpha' }} />));
    if (!host.textContent?.includes('b'.repeat(40)) || !host.textContent.includes('darwin / arm64')) {
      throw new Error('Mounted embedded identity lost the full SHA or target');
    }
    return { missingProvenanceVisible: true, embeddedShaAndTargetVisible: true };
  } finally {
    flushSync(() => root.unmount());
    host.remove();
    setLocale(locale);
  }
}
