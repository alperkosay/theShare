# Plan: Güvenlik sertleştirme

Durum: **Faz 1 ve 2 uygulandı** (açık soru 1: doğrulanana kadar kapalı; 4: 12 rakam). Faz 3–7 bekliyor. Açık sorular en altta.

## Hedef ve dürüst sınır

"Hiç kimse sızamaz" garantisini hiçbir yazılım veremez. Bir devlet aktörü **cihazın kendisini** ele geçirirse (casus yazılım, işletim sistemi ya da tarayıcı açığı, fiziksel erişim) ekranı ve dosyaları uygulamadan bağımsız olarak görür. Signal de, iMessage de bundan korumaz.

Bu planın hedefi şu: **iki cihazın dışındaki herkes** (internet sağlayıcısı, Wi-Fi sahibi, tracker ve STUN işletmecileri, GitHub, ağı dinleyen kurumlar) için şunlar matematiksel olarak sağlansın:

- Aktarılan içerik okunamaz.
- İçerik fark edilmeden değiştirilemez.
- Araya giren biri ya hiç bağlanamaz ya da iki ekranda kırmızı uyarı olarak görünür.

Bu, Signal ve magic-wormhole'un aktarım için verdiği güvenceyle aynı sınıftır.

## Bugünkü durum

Sağlam olanlar:

- Dosya, metin ve ekran doğrudan iki cihaz arasında gider, DTLS ile şifrelidir (ECDHE, ileri gizlilik). Hiçbir sunucuya yüklenmez.
- Gelen her dosya alıcı onayı ister. Karşı taraftan gelen her mesaj doğrulanır; boyutlar sınırlıdır.
- QR ile eşleştirme hiçbir dış hizmete dokunmaz.
- CSP var; analiz kodu, harici font ve CDN yok.

Açıklar (ciddiyet sırasıyla):

1. **6 haneli kod tracker'a karşı zayıf.** Oda kimliği ve AES anahtarı koddan, sabit tuzla PBKDF2 ile türetiliyor. 1 milyon kodun tamamı iyi bir ekran kartıyla yaklaşık 20 saniyede önceden hesaplanabilir. Tracker işletmecisi ya da trafiği gören biri oda kimliğinden kodu, koddan anahtarı bulur ve **araya girebilir**.
2. **Güvenlik kodu araya girmeye karşı yetersiz.** İki ekranda gösterilen 6 haneli kod yaklaşık 20 bit. Araya giren saldırgan iki taraf için de kendi sertifikasını üretir. İki ekranda aynı kodu çıkaracak sertifikaları birkaç dakikada deneme yanılmayla bulabilir. Bu durumda kodları karşılaştırmak bile saldırıyı yakalamaz. (Ölçülmedi; sertifika üretim hızı kaba tahmin.)
3. **Kodu oluşturan taraf gelen bağlantıyı onaylamıyor.** Kodu ilk giren cihaz bağlanır.
4. **Yakındaki cihazlarda** oda anahtarı dış IP'den türüyor ve gizli değil. Aynı IP'deki bir saldırgan, istek ile cevabın arasına girebilir.
5. **Uygulamanın kendisi.** GitHub hesabı ya da Pages ele geçirilirse kötü bir sürüm yayınlanabilir. Kullanıcı "Yenile"ye bastığında bu sürümü alır.
6. **Cihazdaki veriler** (geçmiş, metin önizlemeleri, saklanan kopyalar) şifresiz. Açık bir cihaza fiziksel erişimi olan biri okuyabilir.
7. **Üstveri.** Tracker'lar ve STUN IP adresini ve zamanlamayı görür. Karşı cihaz da P2P'nin doğası gereği IP'yi öğrenir.

## Tehdit modeli: bugün ve plan sonrası

| Saldırgan | Bugün | Plan sonrası |
|---|---|---|
| Ağı dinleyen (ISS, aynı Wi-Fi, devlet) | İçeriği okuyamaz ✅ | ✅ |
| Tracker işletmecisi ya da trafiği izleyen | Kodu kırıp araya girebilir ❌ | Yalnızca tek bir canlı tahmin hakkı (milyonda bir), o da yakalanır ✅ |
| Kodu sizden önce giren yabancı | Sessizce bağlanır ⚠️ | Kod bilinmeden bağlanamaz; bağlanırsa doğrulanmamış görünür ✅ |
| Aynı IP'deki saldırgan (yakındaki cihazlar) | Araya girebilir ⚠️ | 40 bitlik doğrulama kodu ve güvenilen cihazlar ile yakalanır ✅ |
| Güvenlik kodunu taklit eden aktif saldırgan | Dakikalar içinde taklit edebilir ❌ | Taklit pratikte imkânsız (2⁴⁰ deneme, canlı süre içinde) ✅ |
| GitHub/hosting ele geçirilirse | Kötü sürüm dağıtılabilir ❌ | İmzasız sürüm kurulmaz (ilk ziyaret hariç) ✅ |
| npm bağımlılığı zehirlenirse | Fark edilmeyebilir ⚠️ | Kilitli sürümler, imza ve gözden geçirme ✅ |
| Kilitsiz cihaza fiziksel erişim | Geçmiş okunur ⚠️ | İsteğe bağlı uygulama kilidi ile şifreli ✅ |
| Cihazı ele geçirilmiş (casus yazılım, 0-day) | ❌ | ❌ Hiçbir uygulama korumaz |
| Karşı cihazın IP'nizi öğrenmesi | ⚠️ | ⚠️ P2P'nin doğası; gizlemek için aracı sunucu gerekir |

## Faz 1: Cihaz kimliği ve doğrulama (en kritik)

### 1.1 Kalıcı cihaz sertifikası

- Her cihaz bir kez `RTCPeerConnection.generateCertificate({ name: 'ECDSA', namedCurve: 'P-256' })` ile sertifika üretir ve IndexedDB'de saklar. `RTCCertificate` IndexedDB'ye yazılabilir; özel anahtar dışarı çıkarılamaz.
- Tüm bağlantılar bu sertifikayla kurulur. Böylece cihazın DTLS parmak izi sabit kalır ve **cihazın gerçek kimliği** olur. Bugünkü "kalıcı cihaz kimliği" yalnızca beyandır.
- Süre: 1 yıl. Yenilenince güvenilen cihazlarda yeniden doğrulama istenir.

### 1.2 Güçlü güvenlik kodu (SAS)

- Kodun uzunluğu ~20 bitten **40 bite** çıkar: 12 rakam (`482 913 076 551`).
- **Uygulamada değişti:** Kod yalnızca iki parmak izinden türetilemez. Sertifikalar artık kalıcı olduğu için saldırgan iki parmak izini önceden bilir. Kendi iki sertifikası arasında çakışma araması (doğum günü saldırısı) 40 bitte ~2²⁰ denemeyle sonuç verir. Bu yüzden iki taraf da bağlantı başına rastgele bir değer üretir. Değerler şifreli kanalda önce taahhüt edilir (hash), karşı tarafın taahhüdü gelince açıklanır (ZRTP'deki yöntem). Kod, parmak izleri ve iki rastgele değerden türetilir. Saldırgan kendi değerlerini dürüst tarafınkileri görmeden sabitlemek zorunda kalır; her deneme 2⁻⁴⁰ şansla tutar. Bkz. `src/lib/webrtc/verify.ts`.
- QR (fiziksel kanal) ve kodla eşleştirme (Faz 2) zaten doğrulanmış sayılır. Elle karşılaştırma yalnızca yakındaki cihazlar ve kopyala-yapıştır akışında gerekir.

### 1.3 Güvenilen cihazlar (ilk karşılaşmada güven + doğrulama)

- Doğrulanan bir cihazın parmak izi, adı ve türü "Güvenilen cihazlar" listesine kaydedilir. Kimlik beyan edilen id'ye göre değil, parmak izine göre tutulur.
- Sonraki bağlantılarda aynı parmak izi gelirse bağlantı otomatik doğrulanır ve yeşil "Doğrulanmış" rozeti görünür.
- Aynı ada ya da id'ye sahip ama farklı parmak izli bir cihaz gelirse **kırmızı uyarı** çıkar ve dosya alışverişi kapanır.
- Liste profil ayarlarında görüntülenir; tek tek kaldırılabilir.

### 1.4 Doğrulama adımı

- Doğrulanmamış bir bağlantıda iki ekranda da bir sayfa çıkar: "Bu kodu karşı ekranla karşılaştırın: [kod]. Aynı mı?" **Aynı** / **Farklı, bağlantıyı kes**.
- Doğrulanana kadar: üstte sarı "doğrulanmadı" şeridi görünür. Dosya, metin ve ekran paylaşımı kapalıdır; karşı taraftan gelenler de reddedilir. Metin de kapsama alındı, çünkü pano parola taşıyabilir.
- QR: Karşı ekranın QR'ını uygulama içi tarayıcıyla okutan taraf kendiliğinden doğrulanır. Yapıştırılan ya da bağlantıyla (telefonun kamera uygulaması dahil) açılan kod doğrulama ister. Her taraf yalnızca kendi aldığı sinyalin nereden geldiğini bilir.
- Bilinen bedel: Parmak izi artık her bağlantıda aynı. Kodla eşleştirmede zayıf anahtarla şifrelenen SDP'yi çözen bir tracker işletmecisi, cihazı oturumlar arasında tanıyabilir. Faz 2 bunu kapatır.

## Faz 2: Kodla eşleştirmede PAKE

Açık 1'i kökten çözer. 6 haneli kod kalır, ama çevrimdışı deneme yanılma işe yaramaz.

**Uygulamada değişti:** Oda kimliği tüm koddan türetilemez. 10⁶ kod denenerek oda kimliğinden kod bulunur, o zaman PAKE bir şey korumaz. Bu yüzden odayı yalnızca ilk hane seçer (magic-wormhole'daki "nameplate" gibi); PAKE kalan 5 haneye dayanır. Sonuç: deneme başına 10⁻⁵ (planda 10⁻⁶ yazıyordu). 3 yanlış denemede oda kapanır, yani kod başına en çok ~3·10⁻⁵. Aynı ilk haneyle bekleyen başka kullanıcılar aynı odaya düşebilir; anahtar onayı onları ayırır, ama bu bir yanlış deneme sayılır (bu yüzden 1 değil 3 hak var). Akış: M1 `Ya` → M2 `Yb` → M3 katılanın anahtar onayı + şifreli teklif + ad → (kullanıcı onayı) → M4 kodu oluşturanın anahtar onayı + şifreli yanıt. Katılan taraf önce kanıtladığı için kodu oluşturan taraf her yanlış denemeyi görür. Bkz. `src/lib/signaling/code-rendezvous.ts`, `pake.ts`. Kodlama test vektörleriyle doğrulanmadı (draft ile birebir uyumlu değil); bağımsız denetimde bakılmalı.

- **CPace** (IETF taslağı, ristretto255) kullanılır. Kütüphane: `@noble/curves`; denetlenmiş, bağımlılığı yok, saf JS.
- Akış:
  1. İki taraf koddan ve oda kimliğinden üreteci türetir.
  2. `Ya` ve `Yb` tracker üzerinden değiş tokuş edilir.
  3. Ortak anahtar K türetilir.
  4. Anahtar onayı (MAC) gönderilir.
  5. SDP teklif ve cevabı K ile şifrelenip doğrulanarak gönderilir.
- Güvenlik kodu K ve parmak izlerinden türetilir. Bu yüzden iki taraf **otomatik doğrulanmış** olur; elle karşılaştırma gerekmez.
- Saldırgan oturum başına yalnızca **bir canlı tahmin** yapabilir. Anahtar onayı tutmazsa oda hemen kapanır ve kodu oluşturan tarafa "Biri yanlış kodla denedi; yeni kod oluşturun" uyarısı gösterilir.
- Kodu oluşturan tarafa "X bağlanmak istiyor: Kabul et / Reddet" onayı da eklenir (yakındaki cihazlardaki gibi).

## Faz 3: Yakındaki cihazlar

- Güvenilen bir cihaz değilse bağlantı Faz 1.4'teki doğrulama adımından geçer. Bluetooth eşleştirmesindeki sayı karşılaştırmasının aynısı.
- İsteklere hız sınırı ve "Bu cihazı engelle" seçeneği eklenir.
- Kullanıcıya açıkça söylenir: radardaki adlar aynı dış IP'yi paylaşan herkese görünür.

## Faz 4: Uygulamanın kendisi (tedarik zinciri ve barındırma)

### 4.1 İmzalı sürümler

- Bir **Ed25519 sürüm anahtarı** çevrimdışı tutulur; GitHub'da değil, tercihen donanım anahtarında.
- Her sürümde tüm dosyaların SHA-256 listesini içeren bir manifest bu anahtarla imzalanır.
- Service worker açık anahtarı içinde taşır. Yeni sürümü etkinleştirmeden önce imzayı ve dosya hash'lerini doğrular. İmzasız ya da uyuşmayan sürüm **kurulmaz** ve kullanıcı uyarılır.
- Sınır: ilk ziyaret, o anki sunucuya güvenir. Bu yaklaşımın adı ilk kullanımda güvendir; Meta'nın Code Verify eklentisi de aynı mantıkla çalışır.
- **Yeniden üretilebilir derleme:** aynı kaynaktan aynı hash'ler çıkar. Ayarlarda sürüm hash'i gösterilir; herkes yayınlanan kodla karşılaştırabilir.

### 4.2 Bağımlılıklar

- Kesin sürümler kullanılır; kilit dosyasıyla `npm ci` çalıştırılır.
- CI'da `npm audit signatures` ve `npm audit` çalışır.
- Dependabot/Renovate güncellemeleri gözden geçirilerek alınır. Yeni bağımlılık eklemeden önce gerçekten gerekli mi diye bakılır.

### 4.3 Tarayıcı sertleştirmesi

- CSP: `style-src 'self'` ve yalnızca öznitelikler için `style-src-attr 'unsafe-inline'`. `index.html`'deki satır içi `<style>` dosyaya taşınır.
- `require-trusted-types-for 'script'` eklenir; `innerHTML` zaten kullanılmıyor.
- GitHub Pages HTTP başlığı ayarlayamaz. Başlık ayarlayabilen bir barındırmaya geçilirse (Cloudflare Pages ya da Netlify `_headers`) şunlar eklenir:
  - CSP'nin başlık olarak gönderilmesi
  - `frame-ancestors 'none'` (tıklama hırsızlığına karşı)
  - `Cross-Origin-Opener-Policy: same-origin`
  - `Permissions-Policy` (kamera, mikrofon, ekran yakalama yalnızca kendi adresimiz)
  - `Strict-Transport-Security`
- GitHub Pages'te kalınırsa çerçeve içinde açılmayı JavaScript ile engelleme eklenir.

### 4.4 Barındırma ve depo

- GitHub hesabında donanım anahtarıyla iki aşamalı doğrulama.
- `main` dalı korumalı; imzalı commit zorunlu.
- Yayın ortamı (environment) onay gerektirir.

## Faz 5: Cihazdaki veriler

- **Uygulama kilidi** (isteğe bağlı parola): geçmiş, metin önizlemeleri ve saklanan dosya kopyaları AES-GCM ile şifrelenir. Anahtar paroladan türetilir (PBKDF2 600.000 tur ya da wasm Argon2id). Kilit açılmadan uygulama veri göstermez.
- Sınır: dosya tutamaçları (Chrome masaüstü) tarayıcı nesnesidir, şifrelenemez. Yalnızca hangi dosyaların seçildiği görünür, içerik değil.
- **"İz bırakmayan" ön ayarı:** geçmiş kapalı, kopya saklama kapalı, oturum bitince geçici dosyalar silinir. Parçalar bugün de var; tek düğmede toplanır.

## Faz 6: Üstveri

- **Gizli mod:** STUN ve tracker'lar tamamen kapanır, radar kapanır. Yalnızca QR ve yerel ağ kalır. Hiçbir dış hizmet IP'nizi görmez.
- Tracker ve STUN listesi ayarlardan değiştirilebilir. İsteyen kendi tracker'ını kullanabilir (açık kaynak `bittorrent-tracker`).
- Karşı cihazın IP'nizi öğrenmesi P2P'nin doğasıdır. Gizlemek için aracı (TURN) sunucu gerekir; bu, sunucusuz ilkesiyle çelişir. İleride isteğe bağlı olarak düşünülebilir.

## Faz 7: Doğrulama ve test

- **Birim testleri:** CPace test vektörleri, SAS türetme, güvenilen cihaz deposu, imza doğrulama.
- **E2E: araya girme senaryosu.** Üç sayfa (A, saldırgan M, B); M teklif ve cevapları değiştirir. Beklenen: kodla eşleştirmede bağlantı kurulamaz. Elle akışta iki ekranda farklı kodlar ve kırmızı uyarı görünür, dosya alışverişi kapalı kalır.
- **E2E: yanlış kod.** Oda kapanır, kodu oluşturan taraf uyarılır.
- **Fuzz testleri:** `parseControl`, sinyal kodlayıcı ve çizim mesajlarına rastgele ve bozuk girdi.
- Karşı taraftan gelen mesajlara hız sınırı ve bunun testleri.
- `SECURITY.md`: açık bildirme yolu ve bu tehdit modelinin özeti.
- "Yüksek güvenlik" demeden önce **bağımsız bir güvenlik denetimi**. Kriptografik kodu yazanın kendi kendini denetlemesi yeterli değildir.

## Önerilen sıra

1. **Faz 1 + 2:** en büyük kazanç. Bilinen araya girme yollarının hepsini kapatır.
2. **Faz 4:** uygulama dağıtımına karşı koruma.
3. **Faz 3**, sonra **Faz 5 ve 6.**
4. **Faz 7** her fazla birlikte ilerler. Bağımsız denetim en sonda yapılır.

## Açık sorular

1. **Doğrulanmamış cihaz politikası:** dosya alışverişi ve ekran paylaşımı doğrulamaya kadar tamamen kapalı mı olsun (önerilen), yoksa uyarıyla izin mi verilsin?
2. **Barındırma:** GitHub Pages'te mi kalınsın (başlık yok, bazı korumalar eksik), yoksa başlık ayarlayabilen bir yere mi geçilsin (Cloudflare Pages ya da Netlify)?
3. **Sürüm imzası:** imza anahtarını kim tutacak, nerede (donanım anahtarı önerilir)? İmzalamayı sen yapacağın için bu senin kararın.
4. **Güvenlik kodu biçimi:** 12 rakam mı, 4 kelime mi? Kelimeleri sesli okumak daha kolay, rakamlar dilden bağımsız.
