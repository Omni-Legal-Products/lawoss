import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { BuildIdentity } from '../src/lawoss/release/build-identity';
import { setLocale } from '../src/i18n';
test('missing_provenance_has_visible_unknown_label',()=>{setLocale('en');const html=renderToStaticMarkup(<BuildIdentity build={{version:'1.2.3',gitSha:'a'.repeat(40)}}/>);expect(html).toContain('Build identity unavailable');expect(html).not.toContain('a'.repeat(40));});
test('embedded identity shows full copyable commit and target',()=>{setLocale('en');const html=renderToStaticMarkup(<BuildIdentity build={{version:'1.2.3',gitSha:'a'.repeat(40),provenance:'embedded',channel:'alpha',os:'darwin',arch:'arm64',buildEpoch:'123'}}/>);expect(html).toContain('a'.repeat(40));expect(html).toContain('darwin / arm64');expect(html).toContain('Embedded build identity');});
