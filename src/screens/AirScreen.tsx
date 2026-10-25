import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useKeepAlive } from '../hooks/useKeepAlive';
import { formatBytes, formatSpeed } from '../lib/format';
import { MAX_TEXT_LENGTH } from '../lib/transfer/protocol';
import { FountainEncoder } from '../lib/qr/fountain';
import {
  AIR_PRESETS,
  AirError,
  AirReceiver,
  MAX_AIR_BYTES,
  estimateSeconds,
  packAir,
  unpackAir,
  type AirItem,
  type AirPresetId,
} from '../lib/qr/airgap';
import { QrStream } from '../components/QrStream';
import { QrScanner } from '../components/QrScanner';
import { MessageBubble } from '../components/MessageBubble';
import { Thumb, Viewer } from '../components/Preview';
import { Icon } from '../components/Icon';
import { Waiting } from './common';

export type AirMode = 'send' | 'receive';

/** "Zero connection": data goes screen → camera as a stream of QR codes, no network at all. */
export function AirScreen({ mode, onBack }: { mode: AirMode; onBack: () => void }) {
  return (
    <div className="page">
      <button type="button" className="link back" onClick={onBack}>
        ← Geri
      </button>
      {mode === 'send' ? <AirSend /> : <AirReceive />}
    </div>
  );
}

const seconds = (s: number) => (s < 90 ? `${s} sn` : `${Math.round(s / 60)} dk`);

// --- send ---------------------------------------------------------------------

interface Packed {
  label: string;
  size: number;
  data: Uint8Array;
}

function AirSend() {
  const [packed, setPacked] = useState<Packed | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const start = async (load: () => Promise<AirItem>, label: string) => {
    setBusy(true);
    setError(null);
    try {
      const item = await load();
      const data = await packAir(item);
      if (data.length > MAX_AIR_BYTES) {
        setError(`Bu yöntem için fazla büyük (sıkıştırınca ${formatBytes(data.length)}, en fazla ${formatBytes(MAX_AIR_BYTES)}). Büyük dosyaları Wi-Fi ya da kodla bağlanıp gönderin.`);
      } else {
        setPacked({ label, size: item.bytes.length, data });
      }
    } catch {
      setError('Dosya okunamadı.');
    } finally {
      setBusy(false);
    }
  };

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    // Cheap early check; the real limit applies after compression.
    if (file.size > MAX_AIR_BYTES * 8) {
      return setError(`Bu yöntem için fazla büyük. En fazla ${formatBytes(MAX_AIR_BYTES)} (sıkıştırılmış) gönderilebilir.`);
    }
    await start(async () => ({ kind: 'file', name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }), file.name);
  };

  const sendText = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim()) void start(async () => ({ kind: 'text', name: '', bytes: new TextEncoder().encode(text) }), 'Metin');
  };

  if (busy) return <Waiting text="Hazırlanıyor…" />;
  if (packed) return <AirStreaming packed={packed} onDone={() => setPacked(null)} />;

  return (
    <>
      <h1 className="title">Sıfır bağlantıyla gönder</h1>
      <p className="small muted center">
        Hiçbir ağ kullanılmaz: veri bu ekrandan diğer cihazın kamerasına hızla değişen QR kodlarla akar. Saniyede birkaç KB; küçük dosyalar, notlar ve
        şifreler için. En fazla {formatBytes(MAX_AIR_BYTES)}.
      </p>
      <input ref={inputRef} type="file" hidden data-testid="air-file-input" onChange={(e) => void pickFile(e.target.files?.[0]).finally(() => (e.target.value = ''))} />
      <button type="button" className="btn primary big" onClick={() => inputRef.current?.click()}>
        <Icon name="files" />
        Dosya seç
      </button>
      <form className="panel composer" onSubmit={sendText}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={MAX_TEXT_LENGTH}
          rows={3}
          placeholder="…ya da metin, bağlantı, şifre yazın"
          aria-label="Gönderilecek metin"
          data-testid="air-text-input"
        />
        <div className="row">
          <span className="grow" />
          <button type="submit" className="btn small primary" disabled={!text.trim()} data-testid="air-text-send">
            <Icon name="send" />
            QR olarak göster
          </button>
        </div>
      </form>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

function AirStreaming({ packed, onDone }: { packed: Packed; onDone: () => void }) {
  const [presetId, setPresetId] = useState<AirPresetId>('normal');
  const [paused, setPaused] = useState(false);
  const [frame, setFrame] = useState(0);
  const preset = AIR_PRESETS[presetId];
  // A new block size is a new stream (new id): receivers notice and start over.
  const encoder = useMemo(() => new FountainEncoder(packed.data, preset.blockSize), [packed, preset.blockSize]);

  useKeepAlive(!paused);

  const firstPass = frame < encoder.k;
  return (
    <>
      <div className="stack center">
        <span className="filename">{packed.label}</span>
        <span className="small muted">
          {formatBytes(packed.size)}
          {packed.data.length < packed.size * 0.9 && ` · sıkıştırılmış ${formatBytes(packed.data.length)}`} · ~{seconds(estimateSeconds(packed.data.length, preset))}
        </span>
      </div>

      <QrStream encoder={encoder} fps={preset.fps} paused={paused} onFrame={setFrame} />

      <p className="small muted center" data-testid="air-frame">
        {firstPass ? `İlk tur: ${frame + 1} / ${encoder.k}` : `Kare ${frame + 1} · alıcı eksiklerini tamamlıyor`}
      </p>

      <div className="segmented" role="group" aria-label="Hız">
        {(Object.keys(AIR_PRESETS) as AirPresetId[]).map((id) => (
          <button key={id} type="button" className={id === presetId ? 'active' : ''} aria-pressed={id === presetId} onClick={() => setPresetId(id)}>
            {AIR_PRESETS[id].label}
          </button>
        ))}
      </div>

      <div className="actions">
        <button type="button" className="btn" onClick={() => setPaused(!paused)}>
          {paused ? 'Devam' : 'Duraklat'}
        </button>
        <button type="button" className="btn" onClick={onDone}>
          Bitti
        </button>
      </div>

      <p className="small muted center">
        Diğer cihazda <strong>Sıfır bağlantı → Al</strong>'ı açıp kamerayı bu ekrana tutun. Kodlar döngüde akar; alıcı ne zaman başlarsa başlasın ve
        bazı kareleri kaçırsa da tamamlar. Okumuyorsa ekran parlaklığını artırın ya da <strong>Kararlı</strong>'yı seçin.
      </p>
    </>
  );
}

// --- receive ------------------------------------------------------------------

interface Progress {
  decoded: number;
  k: number;
  length: number;
  /** Bytes per second, from recovered blocks. */
  speed: number;
}

type ReceiveState =
  | { step: 'scanning'; progress: Progress | null; note: string | null }
  | { step: 'unpacking' }
  | { step: 'done'; item: AirItem }
  | { step: 'failed'; error: string };

function AirReceive() {
  const [state, setState] = useState<ReceiveState>({ step: 'scanning', progress: null, note: null });
  const [round, setRound] = useState(0);
  const receiver = useMemo(() => new AirReceiver(), [round]);
  const started = useRef(0);
  const ignored = useRef(0);

  useKeepAlive(state.step === 'scanning' && state.progress !== null);

  const onCode = (text: string) => {
    const result = receiver.feed(text);
    if (result === 'duplicate') return;
    if (result === 'ignored') {
      if (++ignored.current === 15 && !receiver.decoder) {
        setState({ step: 'scanning', progress: null, note: 'Bu bir theShare QR akışı değil.' });
      }
      return;
    }
    const dec = receiver.decoder!;
    if (result === 'restarted' || dec.received === 1) started.current = performance.now();
    const elapsed = (performance.now() - started.current) / 1000;
    const progress: Progress = {
      decoded: dec.decoded,
      k: dec.k,
      length: dec.header.length,
      speed: elapsed > 1 ? (dec.decoded * dec.header.blockSize) / elapsed : 0,
    };
    if (!dec.done) {
      setState({ step: 'scanning', progress, note: result === 'restarted' ? 'Gönderen yeni bir akış başlattı; baştan alınıyor.' : null });
      return;
    }
    setState({ step: 'unpacking' });
    unpackAir(dec.result()).then(
      (item) => {
        navigator.vibrate?.(80);
        setState({ step: 'done', item });
      },
      (e) => setState({ step: 'failed', error: e instanceof AirError ? e.message : 'Gelen veri açılamadı.' }),
    );
  };

  const again = () => {
    ignored.current = 0;
    setRound(round + 1);
    setState({ step: 'scanning', progress: null, note: null });
  };

  if (state.step === 'unpacking') return <Waiting text="Açılıyor…" />;
  if (state.step === 'done') return <AirResult item={state.item} onAgain={again} />;
  if (state.step === 'failed') {
    return (
      <>
        <p className="notice error" role="alert">
          {state.error}
        </p>
        <button type="button" className="btn primary big" onClick={again}>
          Tekrar dene
        </button>
      </>
    );
  }

  const p = state.progress;
  const percent = p ? (p.decoded / p.k) * 100 : 0;
  const left = p && p.speed > 0 ? Math.ceil(((p.k - p.decoded) * (p.length / p.k)) / p.speed) : null;
  return (
    <>
      <h1 className="title">Diğer cihazdaki QR akışını tarayın</h1>
      <QrScanner key={round} continuous onResult={onCode} />
      {p ? (
        <div className="stack" data-testid="air-progress" data-decoded={p.decoded} data-total={p.k}>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}>
            <div className="progress-bar" style={{ width: `${percent}%` }} />
          </div>
          <p className="small muted center">
            {Math.floor(percent)}% · {formatBytes(p.length)} · {formatSpeed(p.speed)}
            {left !== null && ` · ~${seconds(left)} kaldı`}
          </p>
        </div>
      ) : (
        <p className="small muted center">Kamerayı gönderen ekrana tutun; kod tüm kareyi kaplamasın, biraz boşluk kalsın.</p>
      )}
      {state.note && <p className="notice">{state.note}</p>}
    </>
  );
}

function AirResult({ item, onAgain }: { item: AirItem; onAgain: () => void }) {
  const text = useMemo(() => (item.kind === 'text' ? new TextDecoder().decode(item.bytes) : ''), [item]);
  const file = useMemo(
    () => (item.kind === 'file' ? new File([item.bytes as Uint8Array<ArrayBuffer>], item.name, { type: 'application/octet-stream' }) : null),
    [item],
  );
  const [saved, setSaved] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [at] = useState(Date.now);
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);

  return (
    <>
      <h1 className="title">Alındı</h1>
      {file && url ? (
        <article className="glass transfer done" data-testid="air-result" data-kind="file">
          <div className="row">
            <span className="arrow" aria-hidden="true">
              <Icon name="check" />
            </span>
            <div className="grow">
              <div className="filename">{file.name}</div>
              <div className="small muted">{formatBytes(file.size)} · içerik doğrulandı</div>
            </div>
            <Thumb file={file} onOpen={() => setViewing(true)} />
            <a className="btn small primary" href={url} download={file.name} onClick={() => setSaved(true)} data-testid="air-download">
              {saved ? 'Tekrar kaydet' : 'Kaydet'}
            </a>
          </div>
          {viewing && <Viewer files={[file]} start={file} onClose={() => setViewing(false)} />}
        </article>
      ) : (
        <div data-testid="air-result" data-kind="text">
          <MessageBubble message={{ id: 'air', direction: 'in', text, at }} />
        </div>
      )}
      <button type="button" className="btn" onClick={onAgain}>
        Yeni tarama
      </button>
    </>
  );
}
