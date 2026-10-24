# Gerçek cihaz test listesi

Otomatik testler yalnızca aynı makinedeki iki Chromium sekmesini kapsar. Aşağıdaki senaryolar gerçek cihazlarda elle denenmeli; sonuçlar README'deki **Test durumu** tablosuna işlenmelidir.

**Ön koşul:** Uygulama HTTPS üzerinden açılmalı (GitHub Pages veya `npm run dev:https`). İki cihaz aynı Wi-Fi ağında olmalı.

Her testte şunları not edin:

- cihaz ve OS sürümü, tarayıcı ve sürümü
- sonuç: ✅ / ❌
- hata ekranındaki "Teknik ayrıntılar"da görünen yol (ör. `host ↔ host`)
- hata varsa tam hata mesajı

## 0. Ağ ön testi (ilk iş bu)

Asıl risk mDNS çözümlemesi; diğer testlere geçmeden önce bunu doğrulayın.

| # | Senaryo | Beklenen |
|---|---|---|
| 0.1 | Ev Wi-Fi'ında masaüstü Chrome ↔ Android Chrome, QR ile (STUN yok) | Bağlanır, yol `host ↔ host` |
| 0.2 | Aynı test, iPhone Safari ile | Bağlanır |
| 0.3 | Telefon hotspot'u + dizüstü bilgisayar | Bağlanır |
| 0.4 | Misafir ağı / AP isolation açık bir ağ | Bağlanamaz; 30 sn içinde açıklayıcı hata ve "Tekrar dene" görünür |
| 0.5 | 0.1 başarısızsa aynı iki cihazı kodla (STUN açık) bağlayın | Sonucu not edin |

## 1. Yakındaki cihazlar

| # | Senaryo | Beklenen |
|---|---|---|
| 1.0a | Aynı Wi-Fi'da telefon ve bilgisayarda uygulamayı açın | Birkaç saniye içinde birbirlerini listede görürler |
| 1.0b | Listeden cihaza dokunun, diğerinde "Kabul et" | Bağlanır |
| 1.0c | "Reddet" | İsteyen tarafta "kabul etmedi" mesajı |
| 1.0d | Telefon mobil veride, bilgisayar Wi-Fi'da | Birbirlerini görmezler (beklenen) |
| 1.0e | Misafir ağı / AP isolation | Görünebilirler ama bağlantı kurulamayabilir; sonucu not edin |

## 1a. 6 haneli kod

| # | Senaryo | Beklenen |
|---|---|---|
| 1a.1 | Masaüstünde "Kod oluştur", telefonda "Kod gir" | Birkaç saniyede bağlanır |
| 1a.2 | Kod ekranındaki QR'ı telefonun kamera uygulamasıyla okutun | Uygulama açılır, otomatik bağlanır |
| 1a.3 | Yanlış kod girin | ~20 sn sonra "bekleyen bir cihaz bulunamadı" mesajı |
| 1a.4 | Biri Wi-Fi, diğeri mobil veride | Çoğu durumda bağlanır; operatöre göre başarısız olabilir. Sonucu ve operatörü not edin |
| 1a.4b | İki telefon da mobil veride (farklı operatörler) | Sonucu not edin; TURN olmadığı için başarısız olabilir |
| 1a.4c | Farklı evlerdeki iki bilgisayar | Bağlanır |
| 1a.5 | Bağlandıktan sonra iki ekrandaki "Güvenlik kodu"nu karşılaştırın | Aynı |

## 1b. ZIP ve sürükle-bırak

| # | Senaryo | Beklenen |
|---|---|---|
| 1b.1 | "Tek ZIP olarak gönder" işaretli, 20 fotoğraf gönderin | Alıcıda tek ZIP; Windows/macOS/Android/iOS'ta açılıyor |
| 1b.2 | Masaüstünde dosyaları pencereye sürükleyip bırakın | Gönderim başlar |

## 1c. QR ile eşleştirme (internetsiz)

| # | Senaryo | Beklenen |
|---|---|---|
| 1.1 | Davet QR'ını telefonun **kendi kamera uygulamasıyla** okutun | theShare açılır, yanıt kodu otomatik üretilir |
| 1.2 | Davet QR'ını uygulama içi tarayıcıyla okutun | Aynı sonuç |
| 1.3 | Yanıt QR'ını masaüstü web kamerasıyla okutun | Bağlanır |
| 1.4 | Kodları yalnızca metinle aktarın (kopyala → mesaj → yapıştır) | Bağlanır |
| 1.5 | Kamera iznini reddedin | "Kamera izni verilmedi…" mesajı çıkar, yapıştırma alanı kullanılabilir kalır |
| 1.6 | Yanıt alanına davet kodunu yapıştırın | "Bu bir yanıt kodu değil…" mesajı |
| 1.7 | Kodun ortasından birkaç karakter silip yapıştırın | "Bağlantı kodu bozuk…" mesajı, uygulama çökmez |
| 1.8 | Yanıt kodunu 1–2 dakika bekledikten sonra okutun | Bağlanır (bekleme süresi tarayıcıya göre değişebilir; sonucu not edin) |
| 1.9 | İki ekrandaki eşleşme kodunu karşılaştırın | Aynı |

## 2. Aktarım

| # | Senaryo | Beklenen |
|---|---|---|
| 2.1 | Masaüstü → Android: fotoğraf | Alınır, "Kaydet" çalışır, dosya açılır |
| 2.2 | Android → masaüstü: video (100 MB+) | Alınır; ilerleme ve hız makul görünür |
| 2.3 | iOS → masaüstü ve masaüstü → iOS | Alınır, "Kaydet" ile Dosyalar'a iner |
| 2.4 | 10+ dosyayı tek seferde gönderin | Tümü sırayla alınır |
| 2.5 | 0 baytlık dosya | Alınır, boyutu 0 |
| 2.6 | 2 GB+ dosya, masaüstü Chrome alıcı, "Kabul et" → konum seçilir | Bellek kullanımı sabit kalır, dosya bozulmaz |
| 2.7 | 1 GB dosya, Android alıcı, "Kabul et" (OPFS) | Alınır |
| 2.8 | 500 MB+ dosya, iOS alıcı | Sonucu not edin (bellek sınırı beklenebilir) |
| 2.9 | Alıcı reddeder | Gönderende "Reddedildi" görünür |
| 2.10 | Aktarım ortasında alıcı iptal eder | İki tarafta da "İptal edildi" görünür |
| 2.11 | Aktarım ortasında alıcı sekmeyi kapatır | Gönderende ~10 sn içinde "Bağlantı koptu" benzeri bir mesaj görünür |
| 2.12 | Aktarım ortasında telefon ekranını kilitleyin | Sonucu not edin; Wake Lock bu durumu önlemeye çalışır |
| 2.13 | Aktarım ortasında Wi-Fi'ı kapatıp açın | Bağlantı ya toparlanır ya da hata gösterilir; uygulama donmaz |
| 2.14 | Bağlantı koptuktan sonra, önceden alınmış dosyaları indirin | İndirilebilir |

## 3. PWA

| # | Senaryo | Beklenen |
|---|---|---|
| 3.1 | Android Chrome: "Uygulamayı yükle" | Ana ekrana eklenir, tam ekran açılır |
| 3.2 | iOS: Paylaş → Ana Ekrana Ekle → aç → QR tara | Kamera çalışır |
| 3.3 | Uygulamayı bir kez açtıktan sonra uçak modunda tekrar açın | Uygulama açılır, QR okuyucu çalışır |
| 3.4 | Yeni sürüm deploy edin, uygulamayı açın | "Yeni sürüm hazır" bildirimi çıkar; aktarım sırasında "Yenile" düğmesi devre dışıdır |
