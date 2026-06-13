# Etsy-Pinterest Otomasyon Aracı

## Hakkında

Bu uygulama, e-ticaret platformundaki ürün ilanlarını otomatik olarak Pinterest'e pin olarak aktaran dahili bir otomasyon aracıdır. Pinterest API v5 üzerinden ürün kataloğundaki her ilan için yüksek çözünürlüklü ürün fotoğrafını, SEO optimize edilmiş başlığı, kısa açıklamayı ve doğrudan ürün sayfasına yönlendiren bağlantıyı içeren pinler oluşturur.

## Amaç

Büyük bir ürün kataloğunu birden fazla platformda yönetmek zaman alıcıdır. Yüzlerce ürün için tek tek Pinterest pini oluşturmak ölçeklenebilir değildir. Bu araç, görsel çekiminden pin oluşturmaya kadar tüm süreci otomatikleştirerek işletme sahibinin zamanını tekrarlayan sosyal medya görevleri yerine ürün geliştirme ve müşteri hizmetlerine ayırmasını sağlar.

Hedef: Pinterest üzerinde organik görünürlük artışı, ürün sayfalarına trafik çekme ve reklam harcaması olmadan satış elde etme.

## Nasıl Çalışır

1. **Kimlik Doğrulama** — Pinterest API v5'e OAuth 2.0 ile bağlanır
2. **Pano Oluşturma** — Pinler için bir Pinterest panosu oluşturur veya mevcut panoyu seçer
3. **Görsel Çekimi** — Her ürün ilanından yüksek çözünürlüklü ürün fotoğrafını alır
4. **Pin Oluşturma** — Her ürünü fotoğraf, başlık, açıklama ve ürün bağlantısı ile pin olarak paylaşır
5. **İlerleme Takibi** — Hangi ürünlerin paylaşıldığını takip eder, yarıda kalırsa kaldığı yerden devam eder

## Teknik Detaylar

- **Platform:** Node.js
- **API:** Pinterest API v5
- **Kimlik Doğrulama:** OAuth 2.0 (Yetkilendirme Kodu Akışı)
- **Hız Sınırlaması:** Pinterest API hız limitlerine uygun çalışır (3 saniyede 1 istek)
- **Devam Edilebilir:** İlerleme yerel JSON dosyasında takip edilir, tekrar çalıştırıldığında daha önce paylaşılan ürünler atlanır

## Kullanılan API Yetkileri

| Yetki | Amaç |
|-------|------|
| `boards:read` | Mevcut panoları okuma, tekrar oluşturmayı önleme |
| `boards:write` | Yeni Pinterest panosu oluşturma |
| `pins:read` | Oluşturulan pinleri doğrulama |
| `pins:write` | Panoya yeni pin oluşturma |

## Kullanım

Bu uygulama **yalnızca kişisel ve kurumsal kullanım** içindir. Tek bir kullanıcıya (hesap sahibine) hizmet eder ve üçüncü taraf kullanıcılara erişim sağlamaz. Hiçbir kullanıcı verisi toplanmaz, depolanmaz veya paylaşılmaz. Uygulama geliştiricinin kendi bilgisayarında yerel olarak çalışır ve barındırılan bir hizmet olarak işlem görmez.

## Gizlilik

Bu uygulama Pinterest kullanıcılarından hiçbir kişisel veri toplamaz, depolamaz veya paylaşmaz. Yalnızca kimliği doğrulanmış hesap sahibinin kendi panoları ve pinleri ile etkileşime girer. Çerez, izleme veya analiz kullanılmaz. Tüm API belirteçleri yerel olarak saklanır ve hiçbir üçüncü tarafa iletilmez.
