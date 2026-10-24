# theShare

Cihazdan cihaza dosya paylaşımı. Aynı Wi-Fi'daki cihazlar listede kendiliğinden görünür; değilse 6 haneli kodla bağlanırsınız. Dosyalar WebRTC ile **doğrudan** karşı cihaza gider. Kendi sunucusu, veritabanı, hesabı ve telemetrisi yoktur. Sadece statik dosyalardan oluşur, **her yerde yayınlanabilir**.

> **Durum: MVP.** Chromium ↔ Chromium akışları otomatik testlerle doğrulandı. Gerçek telefonlar, iOS Safari ve Firefox henüz doğrulanmadı; ayrıntılar için [Test durumu](#test-durumu).

## Hızlı başlangıç

```bash
npm install
npm run dev          # http://localhost:5173
```

| Komut | Açıklama |
|---|---|
| `npm run dev` | Geliştirme sunucusu |
| `npm run dev:https` | Yerel ağa açık, self-signed HTTPS'li sunucu (telefonla test için) |
| `npm run build` | Tip kontrolü + üretim derlemesi → `dist/` |
| `npm run preview` | Derlenmiş sürümü yerelde sunar |
| `npm test` | Birim testleri (Vitest) |
| `npm run test:e2e` | Uçtan uca testler (Playwright, Chromium). İlk seferde `npx playwright install chromium` gerekir. Kodla eşleştirme testleri internet ister |

## Yayınlama: her yerde

`npm run build` sonucu oluşan `dist/` klasörü **sadece statik dosyalardır** (HTML, JS, CSS). Sunucuda Node.js, framework, veritabanı veya özel ayar gerekmez. `dist/` içeriğini yüklemeniz yeterli:

- **GitHub Pages:** Repoyu gönderin, *Settings → Pages → Source: GitHub Actions* seçin. [deploy.yml](.github/workflows/deploy.yml) testleri çalıştırıp otomatik yayınlar.
- **Netlify / Vercel / Cloudflare Pages:** Build komutu `npm run build`, yayın klasörü `dist`.
- **Kendi sunucunuz:** nginx, Apache, Caddy veya herhangi bir statik dosya sunucusu.

Tek şart **HTTPS**. Kamera, pano ve şifreleme API'leri yalnızca güvenli bağlamda çalışır; yukarıdaki servislerin hepsi HTTPS'i kendisi sağlar. `base: './'` sayesinde uygulama alt klasörde de (`https://site.com/theshare/`) çalışır.

## Nasıl bağlanır?

### Yakındaki cihazlar (internet gerekir)

Ana ekranda, aynı ağda theShare'i açmış cihazlar listelenir. Birine dokununca karşı cihazda **onay isteği** çıkar; kabul edilirse bağlantı kurulur.

Tarayıcılar yerel ağı tarayamaz. Bunun yerine şu yöntem kullanılır ([nearby.ts](src/lib/signaling/nearby.ts)):

1. **Genel IP'yi öğrenme:** Aynı Wi-Fi'daki cihazlar aynı genel IP adresini paylaşır. Her cihaz bu adresi bir STUN sunucusundan öğrenir (`stun.l.google.com`, `stun.cloudflare.com`).
2. **Odaya katılma:** Adresten bir oda türetilir. Cihazlar bu odaya aşağıdaki tracker'lar üzerinden katılır ve birkaç saniyede bir şifreli bir "buradayım" mesajı (rastgele cihaz adı + cihaz türü) yayınlar.

Keşif yalnızca ana ekran açıkken çalışır; bağlantı kurulunca durur.

**Bilinen sınırlar:**

- **Aynı IP, aynı ağ demek değildir.** Mobil veride (operatör NAT'ı), büyük ofis veya okul ağlarında tanımadığınız kişiler de aynı genel IP'yi paylaşabilir. Bu kişiler rastgele cihaz adınızı görebilir, ama **onayınız olmadan bağlanamaz**.
- **Genel IP'nizi bilen biri** odayı hesaplayıp aynı şekilde listede görünebilir; yine onay gerekir.
- **IPv6:** Yalnızca IPv6 kullanan ağlarda cihazlar /64 önekine göre gruplanır.
- **STUN ve tracker'lar genel IP'nizi görür;** bu, herhangi bir web sitesini açtığınızda olanla aynıdır.

### 6 haneli kod (internet gerekir; farklı ağlardaki cihazlar için de)

Kodla bağlanmada STUN açıktır, bu yüzden cihazlar farklı ağlarda olabilir (ör. biri evde, biri ofiste). Çoğu ağda çalışır ama garanti değildir, bkz. [Ağ kısıtları](#ağ-kısıtları).

```
 Cihaz A: "Kod oluştur" → 482 913                  Cihaz B: "Kod gir" → 482913
        │                                                    │
        └──── herkese açık WebTorrent tracker'ları ──────────┘
              (yalnızca şifreli bağlantı bilgisi; ~1 sn)
                              ↓
              Doğrudan WebRTC bağlantısı (dosyalar buradan)
```

Bizim bir sunucumuz yok. WebTorrent tracker'ları, tarayıcıların birbirini bulması için zaten var olan, herkese açık ücretsiz "buluşma noktaları"dır. İşleyiş şöyle:

1. Koddan bir oda kimliği ve bir şifreleme anahtarı türetilir (PBKDF2).
2. İki cihaz aynı odaya katılır.
3. Bağlantı bilgisi (SDP) AES-GCM ile şifrelenip tracker üzerinden karşıya iletilir.
4. Bundan sonra tracker devreden çıkar.

[code-rendezvous.ts](src/lib/signaling/code-rendezvous.ts) şu tracker'ları aynı anda kullanır, ilk yanıt veren kazanır:

- `wss://tracker.openwebtorrent.com`
- `wss://tracker.webtorrent.dev`
- `wss://tracker.novage.com.ua`

Ekim 2026 itibarıyla üçü de test edildi. Tracker'lar üçüncü taraf hizmetlerdir ve kapanabilir. Liste tek bir sabitte duruyor; değiştirirseniz CSP otomatik güncellenir.

Kod oluşturan ekranda kodu içeren bir QR da gösterilir. Telefonun kamera uygulamasıyla okutunca kod otomatik girilir. Kodlar 10 dakika geçerlidir.

### QR ile (internet olmadan)

"İnternet yok mu? QR ile bağlan" seçeneği hiçbir dış hizmet kullanmaz. İki cihaz aynı Wi-Fi'da (veya hotspot'ta) olmalıdır.

1. A bir QR gösterir, B okutur.
2. B bir yanıt QR'ı gösterir, A okutur.

Bağlantı bilgisi QR'a sığsın diye SDP küçültülür (~110–200 karakter), bkz. [signal-codec.ts](src/lib/webrtc/signal-codec.ts).

## Özellikler

- **Arayüz:** Mobil uygulama gibi altta bir dock ile üç sekme: **Cihazlar** (radar, bağlantı), **Dosyalar**, **Pano**. Koyu ve açık tema sistem ayarını izler. Animasyonlar "hareketi azalt" ayarına uyar ve dosya aktarımı sürerken süs animasyonları durur. Yazı tipi (Space Grotesk, OFL) uygulamayla birlikte gelir.
- Bir veya çok dosya gönderme, **alıcı onayı zorunlu**
- **Metin ve pano:** Not, bağlantı veya kod gönderme; "Panodakini gönder" ile tek dokunuşta pano içeriği. Gelen metin sohbet balonu olarak görünür ve "Kopyala" ile alınır. Yalnızca `http(s)` bağlantılarına "Aç" düğmesi çıkar; metin her zaman düz metin olarak gösterilir, HTML olarak işlenmez. Metin için onay istenmez, en fazla 100.000 karakter.
- **Cihaz adı ve türü:** Her cihaz rastgele bir ad ("Mavi Kaplan") ve türüyle görünür: iPhone, iPad, Android telefon/tablet, Windows/Linux bilgisayar, Mac. Bu bilgi tarayıcının kendi bildirdiği bilgiden tahmin edilir; gerçek cihaz adı paylaşılmaz.
- **Bağlantı paylaşma:** Kod ekranındaki "Bağlantıyı paylaş" ile kod, link olarak WhatsApp vb. üzerinden gönderilebilir. Linke tıklayan kişi otomatik bağlanır.
- **ZIP olarak gönderme:** Birden çok dosya tek bir `.zip` olarak gidebilir. Sıkıştırma yapılmaz, ZIP gönderen cihazda belleğe kopyalanmadan oluşturulur ([zip.ts](src/lib/transfer/zip.ts)). Toplam en fazla ~4 GB; daha büyükse dosyalar ayrı gider.
- Dosyaları pencereye **sürükle-bırak**
- İlerleme, hız, iptal; bağlantı koparsa bildirim
- İki yönlü: bağlandıktan sonra iki cihaz da gönderebilir
- Çevrimdışı açılış (PWA, service worker)

### Büyük dosyalar

- Dosyalar 64 KiB'lık parçalarla gönderilir.
- İki katmanlı akış kontrolü var:
  - Gönderen tarafta `bufferedAmount` takip edilir.
  - Alıcı, veriyi diske yazdıktan sonra onay (ack) gönderir; gönderen alıcının en fazla 8 MiB önüne geçer.
- Gelen dosyalar nereye yazılır ([sinks.ts](src/lib/transfer/sinks.ts)):
  - **Disk:** 1 GB üstü aktarımlarda masaüstü Chrome/Edge kayıt konumunu sorar, veri doğrudan dosyaya akar.
  - **OPFS:** Destekleyen tarayıcılarda (Chrome, Android Chrome, Firefox, yeni Safari) veri tarayıcının özel depolamasına akar.
  - **Bellek:** Diğerlerinde bellekte toplanır. Çok büyük dosyalar (özellikle iOS'ta) belleğe sığmayabilir.

## Güvenlik ve gizlilik

- **Şifreleme:** Dosyalar WebRTC'nin DTLS şifrelemesiyle doğrudan karşı cihaza gider. Hiçbir sunucuya yüklenmez.
- **6 haneli kod güçlü bir kimlik doğrulama değildir.** Bir milyon olasılık tahminle denenebilir. Asıl koruma iki şey:
  - Bağlandıktan sonra iki ekranda görünen **güvenlik kodu**. Bu kod, iki tarafın DTLS sertifikalarından türetilir; farklıysa araya biri girmiştir.
  - Her aktarım için **alıcı onayı**.
- **Tracker'lar ne görür?** Şifreli bağlantı bilgisini ve WebSocket bağlantısından gelen IP adresinizi görür. Şifreleme, bağlantı bilgisindeki yerel adreslerin sıradan bir gözlemci tarafından okunmasını engeller. Ancak kodu deneme yanılmayla bulan biri şifreyi çözebilir. Hiçbir dış hizmet istemiyorsanız QR yöntemini kullanın.
- **Dosya içeriği ve adları:** Gönderenin beyan ettiği dosya türüne güvenilmez; indirmeler `application/octet-stream` olarak verilir. Dosya adları temizlenir (yol ayraçları, kontrol karakterleri, Windows'a ayrılmış adlar).
- **Veri saklanmaz:** Geçmiş, veritabanı ve `localStorage` kullanımı yoktur. Oturum bitince geçici dosyalar silinir.
- **Dış kaynaklar:** Analiz/izleme, harici font ve CDN yoktur. CSP yalnızca kendi adresimize ve yukarıdaki tracker'lara bağlantıya izin verir.

## Ağ kısıtları

Bağlantı her ağda garanti edilemez.

- **Yerel ağdaki cihazlar arasında genelde çalışır.** Tarayıcılar yerel IP'yi `….local` (mDNS) adlarıyla gizler. Misafir ağları, otel/okul ağları ve "AP isolation" açık routerlar bu adların çözülmesini engeller; telefon hotspot'u genelde işe yarar.
- **Farklı ağlardaki cihazlar:** Kodla ve yakındaki cihazlar listesiyle bağlanırken STUN (`stun.l.google.com`, `stun.cloudflare.com`) kullanılır. Böylece cihazlar genel adresleri üzerinden, router'larını aşarak doğrudan bağlanabilir. Ev, ofis ve kafe ağlarının çoğunda çalışır. STUN sunucusu genel IP'nizi görür, dosyalarınızı görmez. QR yöntemi STUN kullanmaz, hiçbir dış sunucuya bağlanmaz.
- **Her durumda çalışmaz:** Bazı mobil operatörler ("simetrik NAT") ve sıkı güvenlik duvarları doğrudan bağlantıya izin vermez. Örneğin iki telefon da mobil verideyse bağlantı sıkça başarısız olur. Bunu çözmenin tek yolu verinin bir aktarma (TURN) sunucusundan geçmesidir; bu proje bilerek TURN kullanmaz.
- **Teşhis:** Bağlantı kurulamazsa hata ekranındaki "Teknik ayrıntılar" bölümü toplanan adayları ve kullanılan yolu gösterir.

## Tarayıcı farkları

Bu bölüm dokümantasyona dayanır, **gerçek cihazlarda doğrulanmadı**.

- **iOS:**
  - Ekran kilitlenince Safari sayfayı askıya alır ve bağlantı kopar. Aktarım sırasında uygulama ekranı açık tutmaya çalışır (Wake Lock).
  - Kaydedilen dosyalar Dosyalar uygulamasına gider.
  - Büyük dosyalar bellek sınırına takılabilir.
- **QR tarama:** Android Chrome ve macOS'te tarayıcının kendi okuyucusu (`BarcodeDetector`) kullanılır. Diğerlerinde uygulamayla birlikte gelen zxing-wasm kullanılır; CDN'e bağlanmaz.
- **Diske doğrudan kayıt:** Yalnızca masaüstü Chrome/Edge'de.

## Proje yapısı

```
src/
  App.tsx                         ekran seçimi + URL'deki davet (#k=kod, #s=QR-teklifi)
  screens/                        Home, CodeHost, CodeJoin, Host/Join (QR), Session
  components/                     QrCode, QrScanner, CodeEntry, TransferCard, Diagnostics…
  hooks/useSession.ts             bağlantı + aktarım yaşam döngüsü
  lib/signaling/tracker.ts        tracker bağlantıları, oda türetme, şifreleme
  lib/signaling/code-rendezvous.ts  6 haneli kod
  lib/signaling/nearby.ts         yakındaki cihazlar (genel IP → oda)
  lib/webrtc/peer.ts              RTCPeerConnection, ICE, zaman aşımları
  lib/webrtc/signal-codec.ts      SDP küçültme + doğrulama
  lib/transfer/                   protokol, gönderme/alma, ZIP, disk/OPFS/bellek
  lib/qr/                         QR üretme/tarama
```

**Çalışma zamanı bağımlılıkları:** `react`, `react-dom`, `uqr`, `barcode-detector` + `zxing-wasm`, `workbox-window`, `@fontsource-variable/space-grotesk`.

## Test durumu

| Senaryo | Durum |
|---|---|
| Signaling codec, protokol doğrulama, dosya adı temizleme, kod/şifreleme, ZIP biçimi, cihaz/işletim sistemi tespiti, metin mesajı doğrulama | ✅ Birim testi (46) |
| Metin mesajları (HTML olarak işlenmemesi, link "Aç" düğmesi); karşı cihaz adı ve türünün görünmesi | ✅ E2E |
| 6 haneli kodla eşleştirme + aktarım (gerçek tracker'lar üzerinden) | ✅ E2E |
| Kod QR'ıyla otomatik katılma; yanlış kodda anlaşılır hata | ✅ E2E |
| Yakındaki cihazlar: listede görünme → istek → onay → aktarım (aynı makinede iki tarayıcı) | ✅ E2E |
| QR (metin) ile eşleştirme | ✅ E2E |
| Çoklu dosya, 0 bayt, 48 MB; SHA-256 ile içerik kontrolü; ters yön | ✅ E2E |
| ZIP ile gönderim; işletim sisteminin `tar`/`unzip` aracıyla açılıp doğrulanması | ✅ E2E |
| Reddetme, iptal, bağlantı kopması, bozuk kod | ✅ E2E |
| Çevrimdışı açılış | ✅ E2E |
| Chromium ↔ Firefox | ⚠️ Doğrulanmadı: Playwright'ın Firefox sürümü ICE adayı toplamıyor |
| Android, iOS, gerçek LAN, kamera ile QR | ⏳ Gerçek cihazda test edilmedi, bkz. [docs/TESTING.md](docs/TESTING.md) |

## Lisans

[MIT](LICENSE)
