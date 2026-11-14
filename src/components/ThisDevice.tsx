// Settings → Updates (Admin) and My settings (everyone) → This device (web app: Chromebook, phone, browser). The web app's counterpart of
// the desktop app's Updates section: which device this is, whether it runs as an installed app, whether the
// browser keeps its records for good, and which version it runs (updates arrive from the clinic server).
import { useEffect, useState } from 'react';
import { useApp } from '../lib/app';
import { deviceKind } from '../lib/platform';
import { checkWebUpdate, reloadForUpdate, useWebUpdate } from '../lib/webUpdate';
import { installKind, useInstall } from './InstallPrompt';

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;

export function ThisDeviceSection() {
  const { t } = useApp();
  const inst = useInstall();
  const upd = useWebUpdate();
  const [store, setStore] = useState<{ persisted: boolean | null; usage: number | null; quota: number | null }>({ persisted: null, usage: null, quota: null });
  const readStorage = async () => {
    const persisted = (await navigator.storage?.persisted?.().catch(() => null)) ?? null;
    const est = await navigator.storage?.estimate?.().catch(() => null);
    setStore({ persisted, usage: est?.usage ?? null, quota: est?.quota ?? null });
  };
  useEffect(() => {
    void readStorage();
  }, []);
  if (!__CLOUD__) return null;
  const kind = installKind();
  let updLine: string | null = null;
  if (upd.status === 'checking') updLine = t('updates.checking');
  else if (upd.status === 'none') updLine = t('updates.none');
  else if (upd.status === 'ready') updLine = `${t('updates.webReady')} ${t('updates.webReadyHint')}`;
  else if (upd.status === 'offline') updLine = t('updates.webOffline');

  return (
    <div className="form-section this-device">
      <h2>{t('device.title')}</h2>
      <div className="facts" style={{ marginTop: 6 }}>
        <div><span>{t('device.kind')}</span><b>{t(`device.kind_${deviceKind}`)}</b></div>
        <div>
          <span>{t('device.mode')}</span>
          <b>{inst.running ? t('device.installed') : t('device.inBrowser')}</b>
        </div>
        <div>
          <span>{t('device.storage')}</span>
          <b className={store.persisted === false ? 'warn-text' : ''}>
            {store.persisted === null ? '—' : store.persisted ? t('device.storageKept') : t('device.storageMayClear')}
            {store.usage !== null && store.quota ? ` · ${t('device.storageUse', { used: mb(store.usage), of: mb(store.quota) })}` : ''}
          </b>
        </div>
        <div><span>{t('updates.current')}</span><b><code className="ltr">{__BUILD_ID__}</code></b></div>
      </div>
      {!inst.running && (
        <p className="muted small">{inst.canPrompt || inst.manual ? t(`install.body_${kind}`) : t('device.installHowTo')}</p>
      )}
      {store.persisted === false && <p className="note warn small">{t('device.storageHint')}</p>}
      <p className="muted small">{t('updates.webHint')}</p>
      {updLine && <p className="note">{updLine}</p>}
      <div className="row">
        {!inst.running && inst.canPrompt && (
          <button className="btn primary" onClick={async () => { await inst.install(); void readStorage(); }}>{t('install.button')}</button>
        )}
        {store.persisted === false && (
          <button className="btn" onClick={async () => { await navigator.storage?.persist?.().catch(() => false); void readStorage(); }}>{t('device.keep')}</button>
        )}
        <button className="btn" disabled={upd.status === 'checking'} onClick={() => void checkWebUpdate()}>{t('updates.check')}</button>
        {upd.status === 'ready' && <button className="btn primary" onClick={() => void reloadForUpdate()}>{t('updates.reload')}</button>}
      </div>
    </div>
  );
}
