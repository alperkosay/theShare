import { useEffect, useSyncExternalStore } from 'react';
import { session, useSession, type SessionSnapshot } from '../hooks/useSession';
import { toast } from '../hooks/useToast';
import { deviceLabel } from '../lib/device';
import { Icon } from './Icon';

/**
 * Verifying a connection (hooks/useSession): the sheet that asks to compare
 * the security code on both screens, and the strip on top of every tab while
 * the connection isn't verified. Until it is, files, texts and screen sharing
 * stay off.
 */

const needsUser = ({ linkState, verify, peerOutdated }: SessionSnapshot) =>
  linkState === 'connected' && (verify === 'unverified' || verify === 'changed' || verify === 'failed' || (verify === 'checking' && peerOutdated));

/** "Later" hides the sheet; the strip's button brings it back. */
let sheetOpen = true;
const sheetListeners = new Set<() => void>();

function setSheetOpen(open: boolean): void {
  sheetOpen = open;
  for (const l of sheetListeners) l();
}

const subscribeSheet = (listener: () => void) => {
  sheetListeners.add(listener);
  return () => void sheetListeners.delete(listener);
};

const useSheetOpen = () => useSyncExternalStore(subscribeSheet, () => sheetOpen);

function disconnect(): void {
  session.leave();
  toast.show('Bağlantı kesildi. Kodlar farklıysa biri araya girmiş olabilir; mümkünse QR ile yeniden bağlanın.', 'error');
}

/** The security code, grouped for reading aloud. */
export function SecurityCode({ code, testId }: { code: string; testId?: string }) {
  return (
    <strong className="sas-code tabular" data-testid={testId} aria-label={`Güvenlik kodu ${code}`}>
      {code}
    </strong>
  );
}

export function VerifySheet() {
  const state = useSession();
  const open = useSheetOpen();
  const { verify, pairingCode, peerName, peer, lookalike, peerOutdated, wasConnected } = state;

  // Each new connection asks again.
  useEffect(() => {
    if (!wasConnected) setSheetOpen(true);
  }, [wasConnected]);

  if (!needsUser(state) || !open) return null;
  const name = peerName ?? 'Karşı cihaz';

  let title: string;
  let text: string;
  if (verify === 'failed') {
    title = 'Doğrulama başarısız';
    text = 'Güvenlik kodu değiş tokuşu bozuldu. Bağlantıya biri araya girmiş olabilir. Bağlantıyı kesin.';
  } else if (peerOutdated && !pairingCode) {
    title = 'Karşı cihazdaki theShare eski';
    text = `Bağlantıyı doğrulamak için iki cihazda da son sürüm gerekir. ${name} cihazında sayfayı yenileyin, sonra yeniden bağlanın.`;
  } else if (verify === 'changed') {
    title = 'Bu cihazın kimliği değişti';
    text = `Daha önce doğruladığınız ${lookalike?.name ?? name} bu kez farklı bir anahtarla bağlandı. Cihaz sıfırlanmış olabilir, biri onun yerine geçiyor da olabilir. Kodu karşı ekranla mutlaka karşılaştırın.`;
  } else {
    title = 'Bağlantıyı doğrulayın';
    text = `Bu kodu ${name} ekranındakiyle karşılaştırın. Aynıysa arada kimse yok demektir.`;
  }
  const canConfirm = verify !== 'failed' && pairingCode !== null;

  return (
    <div className="sheet-backdrop">
      <div className={`sheet glass verify-sheet${verify === 'changed' || verify === 'failed' ? ' alarm' : ''}`} role="alertdialog" aria-label={title} data-testid="verify-sheet" data-verify={verify}>
        <span className="sheet-grip" aria-hidden="true" />
        <span className="avatar big verify-icon">
          <Icon name="shield" />
        </span>
        <h2>{title}</h2>
        <p className="muted">{text}</p>
        {pairingCode && verify !== 'failed' && <SecurityCode code={pairingCode} testId="sas-code" />}
        {peer && verify !== 'failed' && (
          <p className="small muted">
            {name} · {deviceLabel(peer)}
          </p>
        )}
        {verify === 'unverified' && lookalike && (
          <p className="notice small">Güvendiğiniz başka bir “{lookalike.name}” var, ama bu o cihaz değil.</p>
        )}
        <div className="actions">
          <button type="button" className="btn danger" onClick={disconnect} data-testid="sas-reject">
            {canConfirm ? 'Farklı, bağlantıyı kes' : 'Bağlantıyı kes'}
          </button>
          {canConfirm && (
            <button type="button" className="btn primary" onClick={() => session.confirmCode()} data-testid="sas-confirm">
              Aynı
            </button>
          )}
        </div>
        {verify !== 'failed' && (
          <button type="button" className="link" onClick={() => setSheetOpen(false)}>
            Sonra
          </button>
        )}
      </div>
    </div>
  );
}

/** Shown on top of every tab until both sides have verified the connection. */
export function VerifyStrip() {
  const state = useSession();
  const { linkState, verify, peerVerified, peerName } = state;
  if (linkState !== 'connected') return null;
  if (needsUser(state)) {
    return (
      <div className={`verify-strip${verify === 'unverified' ? '' : ' alarm'}`} role="status" data-testid="verify-strip">
        <Icon name="shield" />
        <span className="grow">Bağlantı doğrulanmadı. Dosya, metin ve ekran paylaşımı kapalı.</span>
        <button type="button" className="btn small" onClick={() => setSheetOpen(true)}>
          Doğrula
        </button>
      </div>
    );
  }
  if (verify === 'verified' && !peerVerified) {
    return (
      <div className="verify-strip waiting" role="status" data-testid="verify-strip">
        <Icon name="shield" />
        <span className="grow">{peerName ?? 'Karşı cihaz'} bağlantıyı doğrulayınca dosya, metin ve ekran paylaşımı açılır.</span>
      </div>
    );
  }
  return null;
}

/** Compact state for headers: the code, and whether it has been checked (in words with `label`). */
export function VerifyBadge({ className = 'sec-code', label = false }: { className?: string; label?: boolean }) {
  const { linkState, pairingCode, verify, verifiedBy } = useSession();
  if (linkState !== 'connected') return null;
  const verified = verify === 'verified';
  const title = verified
    ? verifiedBy === 'trusted'
      ? 'Doğrulanmış: daha önce doğruladığınız cihaz'
      : verifiedBy === 'scan'
        ? 'Doğrulanmış: QR kodu bu cihazla okutuldu'
        : verifiedBy === 'pairing'
          ? 'Doğrulanmış: 6 haneli kodla güvenli eşleşme (karşı taraf kodu biliyor)'
        : 'Doğrulanmış: güvenlik kodları karşılaştırıldı'
    : 'Doğrulanmadı: güvenlik kodunu karşı ekranla karşılaştırın';
  return (
    <span className={`${className}${verified ? ' verified' : ' unverified'}`} title={title} data-testid="verify-badge" data-verify={verify}>
      <Icon name={verified ? 'check' : 'shield'} />
      {label && <span>{verified ? 'Doğrulanmış' : 'Doğrulanmadı'}</span>}
      {pairingCode && <strong className="tabular" data-testid="pairing-code">{pairingCode}</strong>}
    </span>
  );
}
