# Yerel API sağlık kontrolü

Demo veya geliştirme API'si çalışırken başka bir terminalde:

```bash
npm run health
npm run health -- --port 4050 --timeout-ms 5000
```

Komut yalnızca `127.0.0.1` üzerindeki `GET /health` uç noktasını kontrol eder. HTTP 2xx ve `{"status":"ok"}` birlikte gelirse çıkış kodu **0**, bağlantı/yanıt hatasında **1**, geçersiz argümanlarda **2** döner. Başka sunucu adresi kabul etmez; kimlik bilgisi istemez veya veri değiştirmez.

Çevrimdışı birim testleri: `npm run test:health`. Bunlar `npm test` kapsamına da dahildir.
