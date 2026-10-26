import { useEffect, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { profile, useProfile } from '../hooks/useProfile';
import { history, resetEverything, useHistory } from '../hooks/useHistory';
import { saving, useSaveTarget } from '../hooks/useSaving';
import { deviceLabel, selfDevice } from '../lib/device';
import { formatBytes } from '../lib/format';
import { COPY_LIMIT_BYTES } from '../lib/storage/history';
import { NAME_MAX, randomHue, validateName, type Scheme, type Theme } from '../lib/storage/profile';
import { canPickFolder, canShareFiles, saveHint, type SaveMode } from '../lib/transfer/save';
import { InstallSection } from './Install';
import { Icon } from './Icon';
import { Sheet } from './Sheet';

/** Round avatar with the name's first character on the profile's colour. */
export function MeAvatar({ big = false }: { big?: boolean }) {
  const { name, hue } = useProfile();
  const first = typeof Intl.Segmenter === 'function' ? [...new Intl.Segmenter().segment(name)][0]?.segment : [...name][0];
  const initial = first?.toLocaleUpperCase('tr') ?? '?';
  // Pastel tint of the hue, skipping purples and magentas.
  const tint = hue >= 255 && hue < 335 ? hue - 80 : hue;
  return (
    <span className={`me-avatar${big ? ' big' : ''}`} style={{ '--hue': tint } as CSSProperties} aria-hidden="true">
      {initial}
    </span>
  );
}

/** Top-right chip on the Devices tab: avatar + name; opens the settings. */
export function ProfileChip() {
  const { name } = useProfile();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="profile-chip" onClick={() => setOpen(true)} data-testid="profile-chip">
        <MeAvatar />
        <span className="profile-name">{name}</span>
      </button>
      {open && <SettingsSheet onClose={() => setOpen(false)} />}
    </>
  );
}

function NameForm() {
  const { name } = useProfile();
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const result = validateName(value);
  const changed = 'name' in result && result.name !== name;

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if ('error' in result) return setError(result.error);
        setError(null);
        void profile.update({ name: result.name });
      }}
    >
      <div className="row">
        <input
          className="text-input grow"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          maxLength={NAME_MAX * 4}
          autoComplete="nickname"
          enterKeyHint="done"
          aria-label="Görünen ad"
          data-testid="name-input"
        />
        <button type="submit" className="btn primary" disabled={!changed} data-testid="name-save">
          Kaydet
        </button>
      </div>
      {error ? (
        <span className="small error-text" role="alert">
          {error}
        </span>
      ) : (
        <span className="small muted">
          Yakındaki cihazlarda böyle görünürsün: <strong className="text">{'name' in result ? result.name : value}</strong> · {deviceLabel(selfDevice())}
        </span>
      )}
    </form>
  );
}

const THEME_OPTIONS: Array<[Theme, string, string]> = [
  ['soft', 'Soft', 'Kabartma gölgeler'],
  ['mono', 'Sade', 'Siyah‑beyaz'],
  ['pastel', 'Pastel', 'Renkli kartlar'],
];

/** Mini previews as a radio group; the theme switches instantly. Arrow keys move the choice. */
function ThemePicker() {
  const { settings } = useProfile();
  const select = (id: Theme) => void profile.updateSettings({ theme: id });

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const index = THEME_OPTIONS.findIndex(([id]) => id === settings.theme);
    const [next] = THEME_OPTIONS[(index + step + THEME_OPTIONS.length) % THEME_OPTIONS.length]!;
    select(next);
    e.currentTarget.querySelector<HTMLButtonElement>(`[data-testid="theme-${next}"]`)?.focus();
  };

  return (
    <div className="theme-picker" role="radiogroup" aria-label="Tema" onKeyDown={onKeyDown}>
      {THEME_OPTIONS.map(([id, label, hint]) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={settings.theme === id}
          tabIndex={settings.theme === id ? 0 : -1}
          className={`theme-option ${id}${settings.theme === id ? ' active' : ''}`}
          onClick={() => select(id)}
          data-testid={`theme-${id}`}
        >
          <span className="theme-swatch" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span className="theme-label">
            <strong>{label}</strong>
            <span className="theme-radio" aria-hidden="true" />
          </span>
          <span className="small muted">{hint}</span>
        </button>
      ))}
    </div>
  );
}

const SCHEME_OPTIONS: Array<[Scheme, string]> = [
  ['system', 'Sistem'],
  ['light', 'Açık'],
  ['dark', 'Koyu'],
];

/** Light/dark mode: follow the device or force one. Applies to every theme. */
function SchemePicker() {
  const { settings } = useProfile();
  return (
    <div className="segmented" role="group" aria-label="Açık / koyu mod">
      {SCHEME_OPTIONS.map(([id, label]) => (
        <button
          key={id}
          type="button"
          className={settings.scheme === id ? 'active' : ''}
          aria-pressed={settings.scheme === id}
          onClick={() => void profile.updateSettings({ scheme: id })}
          data-testid={`scheme-${id}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ label, hint, checked, onChange, testId }: { label: string; hint?: ReactNode; checked: boolean; onChange: (v: boolean) => void; testId: string }) {
  return (
    <label className="check setting">
      <span className="grow">
        <span className="block">{label}</span>
        {hint && <span className="small muted">{hint}</span>}
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />
      <span className="switch" aria-hidden="true" />
    </label>
  );
}

/** Where received files go: only the options this browser can do are listed. */
function SaveSection() {
  const { settings } = useProfile();
  const { mode, folder } = useSaveTarget();
  const [error, setError] = useState<string | null>(null);
  const os = selfDevice().os;
  const options: Array<[SaveMode, string]> = [
    ['auto', 'Otomatik'],
    ['download', 'İndirilenler klasörü'],
  ];
  if (canShareFiles()) options.push(['share', os === 'ios' ? 'Paylaş menüsü (Dosyalar / Fotoğraflar)' : 'Paylaş menüsü']);
  if (canPickFolder()) options.push(['folder', 'Seçtiğim klasör']);

  const pickFolder = async () => {
    setError(null);
    try {
      await saving.pickFolder();
    } catch (e) {
      if ((e as DOMException).name !== 'AbortError') setError('Klasör seçilemedi.');
    }
  };

  return (
    <>
      <h2 className="eyebrow">İndirme</h2>
      <label className="setting-select">
        <span className="grow">Gelen dosyaları kaydet</span>
        <select
          value={settings.saveMode}
          onChange={(e) => void profile.updateSettings({ saveMode: e.target.value as SaveMode })}
          data-testid="setting-save-mode"
        >
          {options.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {settings.saveMode === 'folder' && canPickFolder() && (
        <div className="row folder-row">
          <Icon name="files" />
          <span className="grow filename">{folder ? folder.name : 'Henüz klasör seçilmedi'}</span>
          <button type="button" className="btn small" onClick={() => void pickFolder()} data-testid="pick-save-folder">
            {folder ? 'Değiştir' : 'Klasör seç'}
          </button>
        </div>
      )}
      {error && (
        <span className="small error-text" role="alert">
          {error}
        </span>
      )}
      <p className="small muted">{saveHint(mode, os, folder?.name ?? null)}</p>
    </>
  );
}

const RETENTION: Array<[string, number | null]> = [
  ['30 gün', 30],
  ['90 gün', 90],
  ['1 yıl', 365],
  ['Süresiz', null],
];

export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const { settings, hue, deviceId } = useProfile();
  const { copyBytes, entries } = useHistory();
  const [usage, setUsage] = useState<number | null>(null);

  useEffect(() => {
    void navigator.storage
      ?.estimate?.()
      .then((e) => setUsage(e.usage ?? null))
      .catch(() => {});
  }, [copyBytes, entries.length]);

  const confirmThen = (question: string, action: () => Promise<void>) => {
    if (confirm(question)) void action();
  };

  return (
    <Sheet label="Profil ve ayarlar" onClose={onClose} testId="settings">
      <div className="row">
        <MeAvatar big />
        <div className="grow">
          <h2>Profil</h2>
          <button type="button" className="link back" onClick={() => void profile.update({ hue: (hue + 60 + randomHue() % 240) % 360 })}>
            <Icon name="shuffle" /> Rengi değiştir
          </button>
        </div>
      </div>

      {/* key: a reset gives a new identity; start the field over */}
      <NameForm key={deviceId} />
      <p className="small muted">
        Ad bir kimlik doğrulaması değildir: herkes kendine istediği adı verebilir. Bağlanırken cihaz türüne ve güvenlik koduna bakın.
      </p>

      {!profile.persistent && (
        <p className="notice small">Bu tarayıcıda kalıcı depolama kullanılamıyor (ör. gizli pencere). Ayarlar ve geçmiş yalnızca bu ziyaret için geçerli.</p>
      )}

      <h2 className="eyebrow">Görünüm</h2>
      <SchemePicker />
      <ThemePicker />

      <SaveSection />

      <InstallSection />

      <h2 className="eyebrow">Geçmiş ve depolama</h2>
      <Toggle label="Geçmişi sakla" checked={settings.keepHistory} onChange={(v) => void profile.updateSettings({ keepHistory: v })} testId="setting-history" />
      <Toggle
        label="Metinleri geçmişe ekle"
        hint="Panoya parola gibi hassas şeyler kopyalanabilir; ilk 200 karakter saklanır."
        checked={settings.includeTexts}
        onChange={(v) => void profile.updateSettings({ includeTexts: v })}
        testId="setting-texts"
      />
      <Toggle
        label="Hızlı yeniden gönderme için dosyaları sakla"
        hint={`${formatBytes(copyBytes)} / ${formatBytes(COPY_LIMIT_BYTES)} kullanılıyor · dosya başına en fazla 500 MB`}
        checked={settings.keepFiles}
        onChange={(v) => void profile.updateSettings({ keepFiles: v })}
        testId="setting-files"
      />
      <label className="setting-select">
        <span className="grow">Geçmişi tutma süresi</span>
        <select
          value={String(settings.retentionDays)}
          onChange={(e) => void profile.updateSettings({ retentionDays: e.target.value === 'null' ? null : Number(e.target.value) })}
        >
          {RETENTION.map(([label, days]) => (
            <option key={label} value={String(days)}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {usage !== null && <p className="small muted">Bu cihazda kullanılan toplam alan: {formatBytes(usage)}</p>}
      <p className="small muted">Bu veriler yalnızca bu cihazda tutulur; hiçbir sunucuya ya da karşı cihaza gönderilmez.</p>

      <div className="stack">
        <button type="button" className="btn" onClick={() => confirmThen('Tüm geçmiş silinsin mi?', () => history.clear())} data-testid="clear-history">
          <Icon name="trash" /> Geçmişi temizle
        </button>
        <button type="button" className="btn" onClick={() => confirmThen('Yeniden gönderme için saklanan dosyalar silinsin mi?', () => history.clearFiles())}>
          <Icon name="trash" /> Saklanan dosyaları sil
        </button>
        <button
          type="button"
          className="btn danger"
          onClick={() => confirmThen('Ad, ayarlar, geçmiş ve saklanan dosyalar silinecek. Emin misin?', resetEverything)}
          data-testid="reset-all"
        >
          Her şeyi sıfırla
        </button>
      </div>
    </Sheet>
  );
}
