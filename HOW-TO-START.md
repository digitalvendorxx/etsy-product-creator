# Etsy Product Creator - nasil baslatilir

```bash
cd "C:\Users\berka\OneDrive\Masaüstü\baby puzzle"
copy .env.example .env
npm install
npm start
```

Sonra tarayicida ac:

```text
http://localhost:3001/baby-puzzle
```

## Etsy API

`.env` veya Ayarlar ekranina sunlari gir:

```bash
ETSY_API_KEY=keystring:shared_secret
ETSY_ACCESS_TOKEN=oauth_access_token
ETSY_SHOP_ID=your_shop_id
ETSY_SHOP_NAME=your_shop_name
```

Not: Keystring ve shared secret tek basina private shop islemleri icin yetmez. Etsy Open API v3 icin OAuth access token ve shop id gerekir.

## Ekranlar

- Urun Olustur: baby puzzle, cocuk parki, ahsap oyuncak, kids furniture gibi urunler icin mockup/listing akisi.
- Operasyon: istatistik, yarim kalan isler, temizlik, tag test ve script calistirma.
- Tedarik & Kar: Rexven benzeri katalog, fulfillment plani ve Etsy kar hesabi.
