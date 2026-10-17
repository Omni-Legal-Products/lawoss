import type { AppBuildInfo } from '@legalwork/types/desktop-ipc';
import { t } from '../../i18n';

export function BuildIdentity({ build }: { build: AppBuildInfo | null }) {
  const provenance = build?.provenance ?? 'unavailable';
  const label = provenance === 'embedded' ? t('settings.build_identity_embedded')
    : provenance === 'development' ? t('settings.build_identity_development')
    : t('settings.build_identity_unavailable');
  return <div data-build-provenance={provenance} className="space-y-1 text-xs text-dls-secondary">
    <div role="status">{label}</div>
    {provenance !== 'unavailable' && <>
      <div className="select-text break-all font-mono">{build?.gitSha ?? '—'}</div>
      <div>{build?.channel ?? '—'} · {build?.os ?? '—'} / {build?.arch ?? '—'} · {build?.buildEpoch ?? '—'}</div>
    </>}
  </div>;
}
