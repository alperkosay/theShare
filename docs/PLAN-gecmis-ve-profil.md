# Plan: Geçmiş, yeniden gönderme ve kullanıcı adı

Durum: **Uygulandı (Faz 1–4).** Açık sorular önerilen yönde kapatıldı (en altta). Ek olarak resim/video önizlemesi eklendi.

## Amaç

1. **Geçmiş:** Bu cihazdan neyi, ne zaman, hangi cihaza gönderdiğimi (ve kimden ne aldığımı) görmek. Örnek: "14:32 · rapor.pdf (2,4 MB) → Yeşil Panda · Windows bilgisayar".
2. **Yeniden gönderme:** Daha önce gönderdiğim bir dosyayı, yeni bir bağlantıda tekrar seçmeden tek dokunuşla göndermek.
3. **Kullanıcı adı:** Rastgele "Mavi Kaplan" yerine kendi adımla görünmek. Bu ad yakındaki cihazlar listesinde, bağlantı isteğinde ve bağlı cihaz çubuğunda kullanılır.

## Değişen bir ilke

Şu an uygulama hiçbir şeyi kalıcı saklamıyor. Bu özellikler için **yalnızca bu cihazda** kalıcı veri tutulacak. Bu veri:

- Hiçbir sunucuya ve karşı cihaza gönderilmez.
- Ayarlardan tek dokunuşla tamamen silinebilir.
- İsteğe bağlıdır: geçmiş ve yeniden gönderme kapatılabilir.

README'deki "veri saklanmaz" bölümü buna göre güncellenecek.

## Mimari

### Depolama: IndexedDB

Kütüphane eklenmeyecek; ~60 satırlık küçük bir sarmalayıcı yazılacak (`src/lib/storage/db.ts`).

| Store | İçerik |
|---|---|
| `history` | Geçmiş kayıtları (aşağıdaki model) |
| `files` | Yeniden gönderme için saklanan dosyalar: dosyanın kendisi (Blob) ya da dosya tutamacı (FileSystemFileHandle) |
| `profile` | Kullanıcı adı, kalıcı cihaz kimliği, ayarlar |

Tarayıcının veriyi kendiliğinden silmemesi için ayar açılınca `navigator.storage.persist()` istenecek. Kullanılan alan `navigator.storage.estimate()` ile ayarlarda gösterilecek.

### Geçmiş kaydı

```ts
interface HistoryEntry {
  id: string;
  at: number;                        // zaman
  direction: 'out' | 'in';
  kind: 'files' | 'text';
  files?: { name: string; size: number; type: string }[];
  textPreview?: string;              // yalnızca ayar açıksa, ilk ~200 karakter
  totalBytes: number;
  status: 'done' | 'failed' | 'cancelled' | 'rejected';
  peer: { id?: string; name: string; kind: DeviceKind; os: DeviceOs };
  method: 'nearby' | 'code' | 'qr';
  resendKey?: string;                // files store'daki kayıt (varsa)
}
```

Kayıt yazma noktaları:

- `TransferManager.finish()`: dosya aktarımı bittiğinde ya da iptal/ret/hatayla sonlandığında.
- `TransferManager.onText`: metin gönderildiğinde ya da alındığında.

Geçmiş, manager'a eklenecek bir `onRecord` olayıyla yazılır; kayıt mantığı arayüzden ayrı kalır.

### Yeniden gönderme: tarayıcıya göre iki yol

| Yol | Nerede | Nasıl çalışır | Bedeli |
|---|---|---|---|
| **Dosya tutamacı** | Masaüstü Chrome/Edge | Dosya `showOpenFilePicker` (veya sürükle-bırakta `getAsFileSystemHandle`) ile seçilir, tutamaç IndexedDB'ye yazılır. Yeniden gönderirken izin bir kez daha sorulur. | Kopya yok, yer kaplamaz. Dosya taşınır ya da silinirse "Dosya bulunamadı" çıkar. |
| **Kopya** | Diğer tüm tarayıcılar (Android, iOS, Firefox) | Gönderilen dosyanın kendisi IndexedDB'ye kaydedilir; tarayıcı bunu diske kopyalar. | Cihazda yer kaplar. Sınır olur (öneri: toplam 2 GB, dosya başına 500 MB). Sınır aşılınca en eski kopyalar silinir. |

Kopya saklanmayan kayıtlarda "Yeniden gönder" dosya seçiciyi açar ve aynı dosyayı bulmayı kolaylaştırmak için dosya adını gösterir.

### Kullanıcı adı ve kalıcı cihaz kimliği

- `selfDevice()` önce profildeki adı kullanır, yoksa bugünkü gibi rastgele ad üretir. Rastgele ad da kalıcı olur; böylece cihaz her açılışta aynı adla görünür.
- Ad kuralları: 2–24 karakter, kontrol karakteri yok (emoji olabilir). Görünüm: "Alper · iPhone".
- **Kalıcı cihaz kimliği:** Rastgele bir UUID üretilip saklanır ve bağlantı başında karşı tarafa gönderilen tanışma mesajına eklenir. Geçmiş bu kimlikle cihazları gruplar ("Alper'in iPhone'una 12 dosya gönderdin"). İleride "kayıtlı cihazlar / favoriler" özelliğinin temeli de bu olur.
- Kimlik doğrulama değildir: Herkes kendine "Annem" adını verebilir. Asıl güvence yine güvenlik kodu ve alıcı onayıdır. Arayüzde ad her zaman cihaz türüyle birlikte gösterilir ve bu kısıt README'ye yazılır.

## Arayüz

### Dock'a 4. sekme: **Geçmiş**

Cihazlar · Dosyalar · Pano · **Geçmiş**

- Kayıtlar güne göre gruplanır: **Bugün**, **Dün**, sonra tarih.
- Her satırda yön oku, dosya adı/sayısı, boyut, saat, karşı cihazın adı ve türü, durum (✓ / iptal / hata).
- Filtreler: **Tümü · Gönderilen · Alınan**, ayrıca ada ya da cihaza göre arama.
- Satıra dokununca alttan bir panel açılır: dosya listesi, **Yeniden gönder** (yalnızca bağlıyken etkin), **Kaydı sil**.
- Bağlı değilken "Yeniden gönder"e basılırsa dosyalar **Bekleyenler**'e eklenir; Dosyalar sekmesinde "Bağlanınca gönderilecek (2)" olarak görünür. Bu, önceki listedeki "bekleyen gönderiler" fikrinin hafif bir hali.
- Boş durum: "Gönderdiğin ve aldığın dosyalar burada listelenir."

### Profil ve ayarlar

Cihazlar sekmesinin sağ üst köşesine profil çipi eklenir: avatar + ad. Dokununca alttan bir ayarlar paneli açılır:

- **Görünen ad** (düzenlenebilir) ve rastgele bir avatar rengi
- **Geçmişi sakla** (açık/kapalı)
- **Metinleri geçmişe ekle** (öneri: varsayılan kapalı; panoya parola gibi hassas şeyler kopyalanabilir)
- **Hızlı yeniden gönderme için dosyaları sakla**: sınır ve kullanılan alan gösterilir
- **Geçmişi temizle**, **Saklanan dosyaları sil**, **Her şeyi sıfırla**

İlk açılışta tek seferlik, atlanabilir küçük bir karşılama: "Adın ne olsun?" alanı ve "Atla".

## Fazlar

| Faz | Kapsam | Bağımlılık |
|---|---|---|
| **1** | IndexedDB sarmalayıcısı, profil (ad + kalıcı kimlik), ayarlar paneli, karşılama | – |
| **2** | Geçmiş kaydı (dosya + isteğe bağlı metin), Geçmiş sekmesi, gruplama, filtre, arama, silme | Faz 1 |
| **3** | Yeniden gönderme: Chromium'da dosya tutamacı, diğerlerinde kopya; kota ve otomatik temizlik | Faz 2 |
| **4** | Bekleyenler kuyruğu (bağlanınca otomatik gönder) | Faz 3 |

## Testler

- **Birim:** IndexedDB sarmalayıcısı (`fake-indexeddb` ile, yalnızca geliştirme bağımlılığı), ad doğrulama, geçmiş gruplama ve filtreleme, kota hesabı.
- **E2E:**
  - Ad belirle → karşı cihazda o adla görün.
  - Dosya gönder → Geçmiş'te doğru dosya adı, saat ve cihaz türü.
  - Sayfayı yenile → kayıt hâlâ orada.
  - Yeni bağlantıda yeniden gönder → içerik birebir aynı (SHA-256).
  - "Her şeyi sıfırla" → hiçbir iz kalmaz.

## Açık sorular (kararlar)

1. **Metinler geçmişe girsin mi?** Varsayılan kapalı, ayarlardan açılabilir; açıkken ilk 200 karakter saklanır.
2. **Yeniden gönderme için dosya kopyaları:** Ayar varsayılan açık; toplam 2 GB, dosya başına 500 MB. Sınırı aşan gönderimlerin kopyası tutulmaz, yeniden gönderirken dosya tekrar seçilir.
3. **Geçmiş ne kadar tutulsun?** Varsayılan 90 gün; 30 gün, 1 yıl ya da süresiz seçilebilir.

## Uygulama notları

- İlk açılıştaki "Adın ne olsun?" kartı sonradan kaldırıldı: ad rastgele başlar, profil çipinden değiştirilir.
- Profil ayarlarına tema seçici eklendi: **Sade** (varsayılan), **Pastel** ve **Soft** (neumorphism).
- "Bekleyenler" bellekte tutulur (sayfa yenilenince boşalır); dosya tutamaçlarının izni zaten kullanıcının dokunuşunu gerektirir.
- Yeniden gönderilen dosyalar aynı kayıt üzerinden saklanır, ikinci bir kopya oluşturulmaz.
- Önizleme türü dosyanın ilk baytlarından anlaşılır; SVG/HTML önizlenmez, HEIC çoğu tarayıcıda gösterilemediği için atlanır.
