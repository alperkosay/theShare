# theShare

Cihazdan cihaza dosya paylaşımı. Aynı Wi-Fi'daki cihazlar listede kendiliğinden görünür; değilse 6 haneli kodla bağlanırsınız. Dosyalar WebRTC ile **doğrudan** karşı cihaza gider. Kendi sunucusu, sunucu tarafında veritabanı, hesabı ve telemetrisi yoktur. Sadece statik dosyalardan oluşur, **her yerde yayınlanabilir**.

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
2. **Odaya katılma:** Adresten bir oda türetilir. Cihazlar bu odaya aşağıdaki tracker'lar üzerinden katılır ve birkaç saniyede bir şifreli bir "buradayım" mesajı (cihaz adı + cihaz türü) yayınlar. Kalıcı cihaz kimliği bu mesajda **yer almaz**.

Keşif yalnızca ana ekran açıkken çalışır; bağlantı kurulunca durur.

**Bilinen sınırlar:**

- **Aynı IP, aynı ağ demek değildir.** Mobil veride (operatör NAT'ı), büyük ofis veya okul ağlarında tanımadığınız kişiler de aynı genel IP'yi paylaşabilir. Bu kişiler cihaz adınızı görebilir, ama **onayınız olmadan bağlanamaz**.
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

### Sıfır bağlantı (hiçbir ağ olmadan)

Ana ekrandaki **Sıfır bağlantı** kartı, iki cihaz arasında **hiçbir bağlantı kurmaz**: Wi-Fi, internet, WebRTC, Bluetooth yok. Gönderen ekranda hızla değişen QR kodlar gösterir, alan cihaz kamerasıyla okur. Uçak modundaki iki cihaz arasında da çalışır. Bu modda yakındaki cihaz keşfi de kapanır.

- **Ne için:** Küçük dosyalar, notlar, şifreler, anahtarlar. En fazla 1 MB (sıkıştırılmış). Hız saniyede birkaç KB'dır: **Kararlı** ~1 KB/sn, **Normal** ~3 KB/sn, **Hızlı** ~7 KB/sn (kamera ve ekrana göre değişir). 100 KB'lık bir dosya Normal hızda yaklaşık 40 saniye sürer.
- **Kaçan kareler sorun değil:** Veri, fountain code ile kodlanır ([fountain.ts](src/lib/qr/fountain.ts)). Önce dosyanın parçaları sırayla gösterilir, ardından parçaların rastgele XOR karışımları sonsuza kadar akar. Alıcı **herhangi** K farklı kareyi okuyunca (K = parça sayısı) dosyayı çözer; hangi kareleri kaçırdığı ya da akışa ne zaman başladığı önemli değildir. Kareler kaybolsa bile gereken kare sayısı teorik sınıra yakındır: %10 kayıpta ~1,11·K, %25 kayıpta ~1,33·K. Çözme, GF(2) üzerinde artımlı Gauss eliminasyonuyla yapılır.
- **Verimli QR:** Veri, QR'ın alfanümerik moduna uyan base45 (RFC 9285) ile yazılır; base64'e göre kare başına ~%30 daha fazla veri sığar. Metin ve sıkıştırılabilen dosyalar `deflate-raw` ile sıkıştırılır.
- **Bütünlük:** Gönderen, orijinal verinin SHA-256'sını da yollar; alıcı birleştirdikten sonra karşılaştırır. Dosya adı, diğer yöntemlerdeki gibi temizlenir; metin HTML olarak işlenmez.
- **Gizlilik:** Kodları gören herkes (ör. ekranı çeken bir kamera) veriyi okuyabilir. Şifreleme yoktur; gizli bir şey gönderirken ekranı yalnızca alıcı cihaza gösterin.
- **Tek yönlü:** Alıcının gönderene "aldım" demesi için bir kanal yoktur. Alıcıda "Alındı" çıkınca gönderende **Bitti**'ye basın.

## Özellikler

- **Arayüz:** Telefonda mobil uygulama gibi altta bir dock ile beş sekme: **Cihazlar** (radar, bağlantı), **Dosyalar**, **Pano**, **Ekran**, **Geçmiş**. Masaüstünde (1024 px ve üstü) dock sol kenar çubuğuna dönüşür (altında bağlı cihaz ve paylaşım durumu), sekmeler genişliği kullanır: ana ekranda radar ve bağlantı yolları yan yana, Dosyalar'da gönderme alanı solda ve aktarımlar sağda, Ekran'da toplantı görünümü tüm pencereyi doldurur; alttan açılan paneller ortada pencere olarak açılır. Bağlandıktan sonra Cihazlar sekmesinde hızlı işlem kartları çıkar. Uygulama simgesi piksel tarzında bir "gönder" okudur; arkasından akan pikseller veriyi anlatır (başlıktaki logoda bu pikseller hafifçe akar). Üç tema, profil → **Görünüm**'den seçilir ve cihazda saklanır: **Sade** (Apple tarzı tek renkli: açık temada beyaz kartlar ve siyah düğmeler, koyu temada tersi, vurgu olarak yalnızca küçük pastel dokunuşlar) ve **Pastel** (yumuşak, oyuncu: pastel dolgulu kartlar, hafif renkli gölgeler, daha yuvarlak köşeler ve Apple cihazlarda yuvarlak sistem yazı tipi) ve **Soft** (varsayılan; Soft UI / neumorphism: yüzeyler arka planla aynı renkte, yalnızca açık ve koyu gölgelerle kabarık ya da içe basık görünür; tek mavi vurgu). Hepsinde düğmeler ve kontroller hap (pill) biçimlidir; koyu/açık mod sistem ayarını izler. Yazı tipi cihazın sistem yazı tipidir (Apple cihazlarda SF Pro). Animasyonlar "hareketi azalt" ayarına uyar ve dosya aktarımı sürerken süs animasyonları durur.
- Bir veya çok dosya gönderme, **alıcı onayı zorunlu**
- **Metin ve pano:** Not, bağlantı veya kod gönderme; "Panodakini gönder" ile tek dokunuşta pano içeriği. Gelen metin sohbet balonu olarak görünür ve "Kopyala" ile alınır. Yalnızca `http(s)` bağlantılarına "Aç" düğmesi çıkar; metin her zaman düz metin olarak gösterilir, HTML olarak işlenmez. Metin için onay istenmez, en fazla 100.000 karakter.
- **Kullanıcı adı ve cihaz türü:** Her cihaza rastgele bir ad ("Mavi Kaplan") verilir ve saklanır. Ad, Cihazlar sekmesinin sağ üstündeki profil çipinden değiştirilir; 2–24 karakter, emoji olabilir. Ad her zaman cihaz türüyle birlikte gösterilir: iPhone, iPad, Android telefon/tablet, Windows/Linux bilgisayar, Mac. Tür, tarayıcının kendi bildirdiği bilgiden tahmin edilir; gerçek cihaz adı paylaşılmaz.
- **Geçmiş:** Bu cihazdan neyin, ne zaman, hangi cihaza gönderildiği ve kimden ne alındığı. Güne göre gruplanır (Bugün, Dün, tarih); Tümü/Gönderilen/Alınan filtresi ve ada ya da cihaza göre arama vardır. Metinler varsayılan olarak geçmişe **girmez**; ayarlardan açılırsa ilk 200 karakter saklanır. Kayıtlar varsayılan olarak 90 gün sonra silinir (30 gün, 1 yıl ya da süresiz seçilebilir).
- **Yeniden gönderme:** Geçmişteki bir gönderimi, yeni bir bağlantıda dosyayı tekrar seçmeden gönderme. Masaüstü Chrome/Edge'de dosyanın kendisi değil **dosya tutamacı** saklanır (yer kaplamaz; yeniden gönderirken okuma izni bir kez daha sorulur, dosya taşındıysa "bulunamadı" denir). Diğer tarayıcılarda gönderilen dosyanın **kopyası** saklanır: toplam en fazla 2 GB, dosya başına 500 MB; sınır aşılınca en eski kopyalar silinir. Kopya yoksa "Yeniden gönder" dosya seçiciyi açar ve hangi dosyanın seçileceğini söyler. Bağlı değilken basılırsa dosya **Bekleyenler**'e eklenir ve bir cihaza bağlanınca kendiliğinden gönderilir (alıcı yine onaylar).
- **Önizleme:** Resim (PNG, JPEG, GIF, WebP, AVIF, BMP) ve video (MP4, WebM, MOV) dosyalarında küçük resim çıkar; dokununca tam ekran açılır, oklarla ya da kaydırarak diğerlerine geçilir. Gelen ve gönderilen dosyalarda, geçmişte de saklanan kopyalarda çalışır. Tür dosyanın adından ya da gönderenin beyanından değil, **ilk baytlarından** anlaşılır; SVG ve HTML hiçbir zaman önizlenmez.
- **Ekran paylaşma:** **Ekran** sekmesinden bir sekme, pencere ya da tüm ekran paylaşılır; istenirse sekme/sistem sesiyle. Görüntü aynı WebRTC bağlantısına eklenir (gerekli yeniden anlaşma veri kanalı üzerinden yapılır), yani eşleştirme yöntemi ne olursa olsun doğrudan ve DTLS ile şifreli gider, sunucudan geçmez. İki cihaz aynı anda paylaşabilir. Paylaşım başlayınca Teams benzeri bir **toplantı görünümü** açılır:
  - **Sahne:** Karşı tarafın ekranı (yalnızca siz paylaşıyorsanız kendi ekranınız, kırmızı çerçeveyle). İkiniz de paylaşıyorsanız diğeri köşede küçük pencerede durur; dokununca yer değiştirir. Başlıkta süre, çözünürlük, fps, bit hızı, katılımcılar ve güvenlik kodu görünür.
  - **Çizim:** Kalem, fosforlu kalem, ok, çizgi, dikdörtgen, elips, 8 renk, 3 kalınlık, silgi, geri al (Ctrl+Z), tümünü sil. Çizimler iki tarafta da anında görünür; her iki taraf da iki ekrana da çizebilir. Koordinatlar paylaşılan görüntüye göre tutulur, ekran boyutu farklı olsa da aynı yere düşer. Çizimler o paylaşıma aittir, paylaşım bitince silinir. Kısayollar: D çizim, Esc kapat.
  - **Lazer işaretçi:** Arkasında solan iz bırakan kırmızı nokta; fareyle basmadan da izler, saklanmaz.
  - **Sohbet:** Sahnenin yanında (telefonda altında); Enter gönderir, Shift+Enter yeni satır. Pano sekmesiyle aynı akıştır, paylaşım bitince de kalır. Sohbet kapalıyken gelen mesaj sahnede kısa bir önizleme ve okunmamış sayısıyla görünür.
  - **Ekran görüntüsü:** Sahnedeki kare çizimleriyle birlikte PNG olarak alınır; **Kaydet** (kayıt ayarına göre) ya da **Gönder** (karşı tarafa dosya olarak, onayla).
  - **Açılır pencere:** Masaüstü Chrome/Edge'de her zaman üstte duran küçük bir pencere (Document Picture-in-Picture): görüntü, çizimler, lazer, sohbet ve Durdur düğmesi. Başka bir pencereyi paylaşırken karşı tarafın çizimlerini görmenin yolu budur. Diğer tarayıcılarda normal resim içinde resim açılır.
  - **Kalite:** **Net** (yazı/kod için çözünürlük korunur) ve **Akıcı** (video için 60 fps'e kadar), paylaşım sırasında da değiştirilebilir. Kalite ve "sesi de paylaş" tercihi profilde saklanır.
  - Tam ekranda tüm toplantı görünümü büyür. Başka sekmeye geçince görüntü küçük oynatıcıda sürer; oynatıcı istenen köşeye sürüklenir ve köşe hatırlanır. İzleyen, karşı tarafın paylaşmasını **isteyebilir**; karşı tarafta "Paylaş / Hayır" bildirimi çıkar. Paylaşmak yalnızca masaüstü tarayıcılarda mümkündür (iOS ve Android tarayıcıları izin vermez); izlemek ve çizmek her yerde çalışır. Paylaşım ya da izleme sürerken ekran açık tutulur.
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
- **Bu cihazda saklanan veriler:** Kullanıcı adı, kalıcı cihaz kimliği, ayarlar, geçmiş ve yeniden gönderme için dosya tutamaçları/kopyaları tarayıcının IndexedDB'sinde, **yalnızca bu cihazda** tutulur. Hiçbir sunucuya gönderilmez; karşı cihaza yalnızca ad, cihaz türü ve kalıcı cihaz kimliği gider (bağlantı kurulduktan sonra). Geçmiş ve dosya saklama ayarlardan kapatılabilir; "Geçmişi temizle", "Saklanan dosyaları sil" ve "Her şeyi sıfırla" tek dokunuşla siler. Tarayıcının veriyi kendiliğinden silmemesi için `navigator.storage.persist()` istenir. Gelen dosyaların geçici kopyaları oturum bitince yine silinir.
- **Ad bir kimlik doğrulaması değildir.** Herkes kendine "Annem" adını verebilir; kalıcı cihaz kimliği de karşı tarafın beyanıdır. Asıl güvence güvenlik kodu ve alıcı onayıdır. Gelen adlardan kontrol ve yön değiştirme (bidi) karakterleri temizlenir.
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
  screens/                        sekmeler (Cihazlar, Dosyalar, Pano, Ekran, Geçmiş) ve eşleştirme akışları
  components/                     QrCode, QrScanner, CodeEntry, TransferCard, Diagnostics…
  hooks/useSession.ts             bağlantı + aktarım yaşam döngüsü
  lib/signaling/tracker.ts        tracker bağlantıları, oda türetme, şifreleme
  lib/signaling/code-rendezvous.ts  6 haneli kod
  lib/signaling/nearby.ts         yakındaki cihazlar (genel IP → oda)
  lib/webrtc/peer.ts              RTCPeerConnection, ICE, zaman aşımları
  lib/webrtc/signal-codec.ts      SDP küçültme + doğrulama
  lib/webrtc/media.ts             ekran paylaşma: veri kanalı üzerinden yeniden anlaşma (perfect negotiation), kalite, istatistik
  hooks/useScreenShare.ts         ekran paylaşma durumu (paylaşım, izleme, istekler)
  lib/ink.ts, hooks/useInk.ts     ekran üzerine çizim: şekiller, doğrulama, çizdirme; iki taraf arası eşitleme
  screens/Meeting.tsx             toplantı görünümü (sahne, kontrol çubuğu, sohbet); components/PopOut.tsx açılır pencere
  lib/transfer/                   protokol, gönderme/alma, ZIP, disk/OPFS/bellek
  lib/qr/                         QR üretme/tarama; sıfır bağlantı: base45, fountain code, paketleme (airgap.ts)
  lib/storage/                    IndexedDB, profil, geçmiş, yeniden gönderme
  lib/preview.ts                  önizleme için içerikten tür tespiti
  lib/logo.ts                     piksel logo (uygulama içi logo + scripts/gen-icons.mjs)
  hooks/useProfile.ts, useHistory.ts  profil; geçmiş + bekleyenler
```

**Çalışma zamanı bağımlılıkları:** `react`, `react-dom`, `uqr`, `barcode-detector` + `zxing-wasm`, `workbox-window`.

## Test durumu

| Senaryo | Durum |
|---|---|
| Signaling codec, protokol doğrulama, dosya adı temizleme, kod/şifreleme, ZIP biçimi, cihaz/işletim sistemi tespiti, metin mesajı doğrulama, IndexedDB sarmalayıcısı (`fake-indexeddb`), ad doğrulama, geçmiş gruplama/filtreleme, kota hesabı, önizleme türü tespiti | ✅ Birim testi (80) |
| Ad belirleme → karşı cihazda o adla görünme; geçmişte dosya adı, saat ve cihaz türü; yenilemeden sonra kaydın kalması; bağlı değilken yeniden gönder → bekleyenler → yeni bağlantıda otomatik gönderim (SHA-256); "Her şeyi sıfırla" sonrası boş depolama | ✅ E2E |
| Ekran paylaşma: istek → onay → görüntünün gelmesi (640×360); izleyenin kalem ve ok çizimlerinin paylaşan tarafa ulaşması, geri alma, paylaşan taraftan tümünü silme; toplantı sohbeti; ekran görüntüsü kaydetme ve gönderme; iki yönlü eş zamanlı paylaşım; diğer sekmede küçük oynatıcı; durdurma; reddedilen istek; sesle yeniden paylaşım (sahte ekran seçici: canvas akışı) | ✅ E2E |
| Çizim: şekil doğrulama, ink/point mesajları, contain yerleşimi, silgi isabet testi | ✅ Birim testi |
| Açılır pencere (Document PiP), sürüklenebilir mini oynatıcı, dokunmatik ekranda çizim, masaüstü düzeninin farklı pencere boyutları | ⏳ Elle test edilmeli |
| Ekran paylaşma: gerçek ekran seçici, Chromium ↔ Firefox/Safari arası yeniden anlaşma, mobil cihazda izleme | ⏳ Gerçek cihazda test edilmedi |
| Gelen resimde küçük resim ve tam ekran önizleme (yanıltıcı ad/türle bile içerikten tespit) | ✅ E2E |
| Dosya tutamacıyla yeniden gönderme (masaüstü Chrome/Edge seçicisi) | ⏳ Elle test edilmeli: Playwright yerel seçiciyi açamaz |
| Metin mesajları (HTML olarak işlenmemesi, link "Aç" düğmesi); karşı cihaz adı ve türünün görünmesi | ✅ E2E |
| 6 haneli kodla eşleştirme + aktarım (gerçek tracker'lar üzerinden) | ✅ E2E |
| Kod QR'ıyla otomatik katılma; yanlış kodda anlaşılır hata | ✅ E2E |
| Yakındaki cihazlar: listede görünme → istek → onay → aktarım (aynı makinede iki tarayıcı) | ✅ E2E |
| QR (metin) ile eşleştirme | ✅ E2E |
| Sıfır bağlantı: base45, fountain code (kayıplı/sırasız/geç başlayan alıcı), paketleme ve bozuk veri reddi | ✅ Birim testi |
| Sıfır bağlantı: gerçek QR çizimi → sahte kamera → zxing-wasm ile okuma → dosya (SHA-256) ve metin; hiç WebSocket/WebRTC açılmadığı | ✅ E2E |
| Sıfır bağlantı: gerçek kamerayla ekrandan okuma hızı | ⏳ Gerçek cihazda test edilmedi |
| Çoklu dosya, 0 bayt, 48 MB; SHA-256 ile içerik kontrolü; ters yön | ✅ E2E |
| ZIP ile gönderim; işletim sisteminin `tar`/`unzip` aracıyla açılıp doğrulanması | ✅ E2E |
| Reddetme, iptal, bağlantı kopması, bozuk kod | ✅ E2E |
| Çevrimdışı açılış | ✅ E2E |
| Chromium ↔ Firefox | ⚠️ Doğrulanmadı: Playwright'ın Firefox sürümü ICE adayı toplamıyor |
| Android, iOS, gerçek LAN, kamera ile QR | ⏳ Gerçek cihazda test edilmedi, bkz. [docs/TESTING.md](docs/TESTING.md) |

## Lisans

[MIT](LICENSE)
