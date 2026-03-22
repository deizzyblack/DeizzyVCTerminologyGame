// ============================================================
// 212 INVOICE TRACKER v3.0 — Google Apps Script + Gemini AI
// ============================================================
// Gmail'ini tarar, fatura maillerini bulur, PDF içini okur,
// Gemini AI ile akıllı analiz yapar, Google Sheet'e yazar,
// eksik vendor hatırlatması yapar, özet bildirim maili gönderir.
//
// KURULUM:
// 1. Google Sheet aç → Extensions → Apps Script
// 2. Bu kodu yapıştır
// 3. Drive API'yi aktifle (Services → Drive API → Add)
//    ÖNEMLİ: Drive API versiyonunu v3 olarak seçin!
// 4. Gemini API key al: https://aistudio.google.com/apikey
//    ÜCRETSİZ: gemini-2.0-flash → 15 istek/dk, 1M token/gün
// 5. Aşağıdaki GEMINI_API_KEY alanına key'i yapıştır
// 6. setupTriggers() fonksiyonunu bir kere çalıştır
// 7. Yetki iste → izin ver
// ============================================================
// ==================== AYARLAR ====================
const CONFIG = {
  // Kaç günlük maili tarasın
  SCAN_DAYS: 7,

  // Bildirim maili gönderilecek adres
  // Apps Script iş hesabınızda çalıştığı için otomatik olarak
  // Session.getActiveUser().getEmail() kullanır (iş mailiniz)
  NOTIFICATION_EMAIL: "", // Boş bırakırsan iş mailine gider

  // Sheet isimleri
  SHEET_FOUND: "📧 Bulunan Faturalar",
  SHEET_VENDORS: "⚠️ Eksik Vendorlar",
  SHEET_UNREADABLE: "🔴 Okunamayan PDFler",
  SHEET_NEW_VENDORS: "🆕 Yeni Vendorlar",
  SHEET_CROSSCHECK: "🔍 Cross-Check",
  SHEET_KNOWN_INVOICES: "📋 Bilinen Faturalar",
  SHEET_LOG: "📝 Log",

  // Fatura anahtar kelimeleri
  INVOICE_KEYWORDS: [
    "invoice", "fatura", "rechnung", "facture", "faktura",
    "payment due", "amount due", "fee note", "debit note",
    "tax invoice", "proforma", "credit note",
    "ödeme", "hesap özeti", "borç dekontu"
  ],

  // False positive azaltma — anahtar kelimeler
  EXCLUDE_KEYWORDS: [
    "newsletter", "unsubscribe", "marketing", "promotion",
    "webinar", "event invitation", "happy hour", "out of office",
    "expense report", "calendar invitation", "meeting invitation",
    "accepted:", "declined:", "tentative:"
  ],

  // GÖNDERENLERİ EXCLUDE ET — bu kişilerden gelen mailler fatura değil
  EXCLUDE_SENDERS: [
    "dogukan@212.vc",      // Ben — benim gönderdiğim onay mailleri fatura değil
    "deniz",               // Deniz — fatura ile ilgisi yok
    "selma"                // Selma — expense report gönderiyor, fatura değil
  ],

  // SUBJECT EXCLUDE — bu kelimeler subject'te geçiyorsa atla
  EXCLUDE_SUBJECTS: [
    "expense report",      // Selma'nın expense reportları
    "toplantı daveti",     // Toplantı davetleri
    "meeting invite",
    "calendar:",
    "accepted:",
    "declined:"
  ],

  // ÖDENMİŞ FATURA TESPİTİ — bu kelimeler varsa "zaten ödenmiş" olarak işaretle
  ALREADY_PAID_INDICATORS: [
    "payment made",        // Zoho faturaları — Payment Made = ödenmiş
    "balance due: $0",
    "balance due: 0",
    "already paid",
    "paid in full"
  ],

  // ÖNEMLİ FORWARDER'LAR — bu kişilerden gelen forward'lar ÖNCELİKLİ
  IMPORTANT_FORWARDERS: [
    "onur@212.vc"          // Onur — kaçırılan faturaları forward eder
  ],

  // Bilinen vendor email domain parçaları
  VENDOR_DOMAINS: [
    "hawksford", "amstone", "tamimi", "vistra", "mazars",
    "eurotraduc", "ustaxfs", "investeurope", "informa",
    "dechert", "fladgate", "orrick", "vestbee", "vauban",
    "deloitte", "ey.com", "kpmg", "audit", "schoenherr",
    "loyens", "moroglu", "dryocopus", "mevca", "ebury"
  ],

  // Onay maili şablonu
  APPROVAL_EMAIL_TO: "", // Onay alınacak kişinin maili — setupte doldur
  APPROVAL_EMAIL_SUBJECT_PREFIX: "Ödeme Onayı — ",
  APPROVAL_EMAIL_SIGNATURE: "", // İsim — setupte doldur

  // ==================== GEMİNİ AI AYARLARI ====================
  // API Key: https://aistudio.google.com/apikey adresinden al (ÜCRETSİZ)
  // Model: gemini-2.0-flash — hızlı, ücretsiz, fatura analizi için ideal
  // Limitler: 15 istek/dakika, 1M token/gün (fatura tarama için fazlasıyla yeterli)
  GEMINI_API_KEY: "",  // ← BURAYA API KEY'İNİ YAPIŞTIR
  GEMINI_MODEL: "gemini-2.0-flash",
  GEMINI_ENABLED: true  // false yaparak AI'yi devre dışı bırakabilirsin
};
// ==================== AY BAZLI VENDOR PATTERNLERİ ====================
const MONTHLY_VENDOR_PATTERN = {
  1: ["ACSE","Actifit","Affinity","Amstone","Bunch Capital","CSSF","Erta SMMM A.Ş.","Hawksford","Igniters Tech Consulting LLC.","Intabulis SCSp","Kolay İK","Mazars","Schönherr","Tamimi","The Audit Company"],
  2: ["Amstone","Dryocopus LLC","Erta SMMM A.Ş.","Girişim Akademi","Hawksford","Kyocera","Moroğlu Arseven","Natus İletişim","Talent Melon","Tamimi","The Audit Company","Vistra"],
  3: ["Amstone","Erta SMMM A.Ş.","Hawksford","INAM","Invest Europe","Kyocera","Natus İletişim","Talent Melon","Tamimi","USTAXFS","Vistra"],
  4: ["Doğan Burda","Dryocopus LLC","Elmira Bayraslı","Erta SMMM A.Ş.","Hawksford","Kyocera","Natus İletişim","Tamimi"],
  5: ["Amstone","Endeavor Derneği","Erta SMMM A.Ş.","Hawksford","Kyocera","Natus İletişim","Tamimi","Vistra"],
  6: ["Erta SMMM A.Ş.","Hawksford","Juniper","Kyocera","Moroğlu Arseven","Talent Melon","Tamimi"],
  7: ["Chamber of Commerce Luxembourg","Erta SMMM A.Ş.","Hawksford","Intabulis SCSp","Kyocera","Moroğlu Arseven","Tamimi","Van Campen Liem"],
  8: ["Erta SMMM A.Ş.","Hawksford","Kyocera","Talent Melon","Tamimi","Vira Yatçılık"],
  9: ["DHL","Erta SMMM A.Ş.","Hawksford","Kyocera","Specter","Tamimi"],
  10: ["Administration des Contributions Directes","Bunch Capital","Erta SMMM A.Ş.","Hawksford","Kyocera","Mazars","Tamimi"],
  11: ["Erta SMMM A.Ş.","Eurtraduc","Hawksford","Moroğlu Arseven","Talent Melon","Tamimi","Venture360"],
  12: ["Erta SMMM A.Ş.","Hawksford","Tamimi"]
};
// Tüm bilinen vendor isimleri (pattern'den çıkarılmış)
const ALL_KNOWN_VENDORS = [...new Set(Object.values(MONTHLY_VENDOR_PATTERN).flat())];
// ==================== GEMİNİ AI FONKSİYONLARI ====================

/**
 * Gemini AI kullanılabilir mi kontrol eder
 */
function isGeminiAvailable() {
  return CONFIG.GEMINI_ENABLED && CONFIG.GEMINI_API_KEY && CONFIG.GEMINI_API_KEY.length > 10;
}

/**
 * Gemini API'ye istek gönderir
 * @param {string} prompt - Gönderilecek prompt
 * @param {number} maxTokens - Maksimum yanıt token sayısı (default: 1024)
 * @returns {string|null} - Gemini yanıtı veya hata durumunda null
 */
function callGemini(prompt, maxTokens) {
  if (!isGeminiAvailable()) return null;

  var maxT = maxTokens || 1024;
  var url = "https://generativelanguage.googleapis.com/v1beta/models/"
    + CONFIG.GEMINI_MODEL + ":generateContent?key=" + CONFIG.GEMINI_API_KEY;

  var payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      maxOutputTokens: maxT,
      temperature: 0.1  // Düşük sıcaklık = tutarlı, deterministik yanıt
    }
  };

  try {
    var response = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    var code = response.getResponseCode();
    if (code !== 200) {
      Logger.log("Gemini API hata (" + code + "): " + response.getContentText().substring(0, 200));
      return null;
    }

    var json = JSON.parse(response.getContentText());
    if (json.candidates && json.candidates[0] && json.candidates[0].content) {
      return json.candidates[0].content.parts[0].text;
    }
    return null;
  } catch (e) {
    Logger.log("Gemini API bağlantı hatası: " + e.message);
    return null;
  }
}

/**
 * Gemini ile fatura içeriğini analiz eder (PDF metin veya mail body)
 * JSON formatında yapılandırılmış veri döner
 *
 * @param {string} text - Analiz edilecek metin (PDF içeriği veya mail body)
 * @param {string} from - Gönderen email adresi
 * @param {string} subject - Mail konusu
 * @returns {object|null} - {isInvoice, vendor, amount, currency, invoiceNo, confidence, summary}
 */
function analyzeWithGemini(text, from, subject) {
  if (!isGeminiAvailable()) return null;

  // Metni 4000 karakterle sınırla (token tasarrufu)
  var truncatedText = (text || "").substring(0, 4000);

  var prompt = `Sen bir fatura analiz asistanısın. Aşağıdaki metin bir email veya PDF'den alınmıştır.
Bu metnin bir FATURA olup olmadığını analiz et ve bilgileri çıkar.

Gönderen: ${from || "bilinmiyor"}
Konu: ${subject || "bilinmiyor"}

--- METİN BAŞI ---
${truncatedText}
--- METİN SONU ---

SADECE aşağıdaki JSON formatında yanıt ver, başka hiçbir şey yazma:
{
  "isInvoice": true/false,
  "confidence": 0-100,
  "vendor": "vendor/şirket adı veya boş string",
  "amount": "sadece rakam, nokta ile ondalık (örn: 1234.56) veya boş string",
  "currency": "EUR/USD/TRY/GBP/AED/CHF veya boş string",
  "invoiceNo": "fatura numarası veya boş string",
  "dueDate": "vade tarihi YYYY-MM-DD veya boş string",
  "summary": "tek cümle açıklama (Türkçe)"
}

ÖNEMLİ KURALLAR:
- Sadece kesin olduğun bilgileri doldur, emin değilsen boş string bırak
- "Payment Made", "Payment Receipt" gibi ödeme makbuzları fatura DEĞİLDİR
- Newsletter, pazarlama, davet mailleri fatura DEĞİLDİR
- Tutarı Avrupa formatından (1.234,56) US formatına (1234.56) çevir
- confidence: 90+ = kesin fatura, 60-89 = muhtemelen, 0-59 = fatura değil`;

  var response = callGemini(prompt, 512);
  if (!response) return null;

  try {
    // Gemini yanıtından JSON'u çıkar (bazen markdown code block içinde gelir)
    var jsonStr = response;
    var jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) jsonStr = jsonMatch[0];

    var parsed = JSON.parse(jsonStr);

    return {
      isInvoice: parsed.isInvoice === true,
      vendor: String(parsed.vendor || "").trim(),
      amount: String(parsed.amount || "").trim(),
      currency: String(parsed.currency || "").toUpperCase().trim(),
      invoiceNo: String(parsed.invoiceNo || "").trim(),
      dueDate: String(parsed.dueDate || "").trim(),
      confidence: parseInt(parsed.confidence) || 0,
      summary: String(parsed.summary || "").trim(),
      source: "gemini"
    };
  } catch (e) {
    Logger.log("Gemini JSON parse hatası: " + e.message + " | Yanıt: " + (response || "").substring(0, 200));
    return null;
  }
}

// ==================== ANA FONKSİYONLAR ====================
/**
 * Ana tarama fonksiyonu — her gün otomatik çalışır
 */
function dailyScan(customDays) {
  var scanDays = customDays || CONFIG.SCAN_DAYS;
  const ss = getOrCreateSpreadsheet();
  const startTime = new Date();

  log(ss, "🔍 Tarama başladı (" + scanDays + " gün)... " + (isGeminiAvailable() ? "🤖 Gemini AI aktif" : "📝 Klasik mod"));

  try {
    // 0. Drive'daki Excel'den bilinen faturaları senkronize et
    try {
      syncFromDriveExcel();
    } catch(syncErr) {
      log(ss, "⚠️ Excel sync atlandı: " + syncErr.message);
    }

    // 1. Gmail'i tara
    const scanResult = scanGmail(scanDays);
    log(ss, `📧 ${scanResult.invoices.length} potansiyel fatura, ${scanResult.unreadablePdfs.length} okunamayan PDF, ${scanResult.newVendors.length} yeni vendor`);

    // 2. Bulunan faturaları yaz
    const newCount = writeFoundInvoices(ss, scanResult.invoices);

    // 3. Okunamayan PDF'leri yaz
    writeUnreadablePdfs(ss, scanResult.unreadablePdfs);

    // 4. Yeni vendor'ları yaz
    writeNewVendors(ss, scanResult.newVendors);

    // 5. Cross-check
    crossCheck(ss, scanResult.invoices);

    // 6. Vendor hatırlatması
    const missingVendors = checkMissingVendors(ss, scanResult.invoices);

    // 7. Özet bildirim maili gönder
    sendNotificationEmail(ss, {
      newInvoices: newCount,
      totalFound: scanResult.invoices.length,
      unreadablePdfs: scanResult.unreadablePdfs,
      newVendors: scanResult.newVendors,
      missingVendors: missingVendors
    });

    const duration = ((new Date() - startTime) / 1000).toFixed(1);
    log(ss, `✅ Tarama tamamlandı (${duration}s)`);

  } catch (e) {
    log(ss, `❌ HATA: ${e.message}`);
    // Hata olsa bile bildirim gönder
    sendErrorNotification(e.message);
    throw e;
  }
}
/**
 * Gmail'i tarar, fatura olabilecek mailleri bulur
 */
function scanGmail(days) {
  const invoices = [];
  const unreadablePdfs = [];
  const newVendors = [];
  var pdfProcessedCount = 0;
  var PDF_LIMIT = 30; // Maksimum PDF işleme sayısı (Drive API kota koruması)

  const afterDate = new Date();
  afterDate.setDate(afterDate.getDate() - days);
  const dateStr = Utilities.formatDate(afterDate, Session.getScriptTimeZone(), "yyyy/MM/dd");

  const keywordQuery = CONFIG.INVOICE_KEYWORDS.map(k => `"${k}"`).join(" OR ");

  const queries = [
    `after:${dateStr} (${keywordQuery})`,
    `after:${dateStr} has:attachment filename:pdf`
  ];

  const seenMessageIds = new Set();

  for (const query of queries) {
    let threads;
    try {
      threads = GmailApp.search(query, 0, 150);
    } catch (e) {
      Logger.log("Search error: " + e.message);
      continue;
    }

    for (const thread of threads) {
      const messages = thread.getMessages();

      for (const msg of messages) {
        const msgId = msg.getId();
        if (seenMessageIds.has(msgId)) continue;
        if (msg.getDate() < afterDate) continue;

        seenMessageIds.add(msgId);

        const subject = msg.getSubject() || "";
        const from = msg.getFrom() || "";
        const body = msg.getPlainBody() || "";
        const attachments = msg.getAttachments();
        const lowerFrom = from.toLowerCase();
        const lowerSubject = subject.toLowerCase();
        const lowerBody = body.toLowerCase();
        const lowerAll = lowerSubject + " " + lowerBody;

        // === EXCLUDE KURALLARI ===

        // 1. Gönderen exclude (dogukan@212.vc, deniz, selma)
        var skipSender = false;
        for (var ex = 0; ex < CONFIG.EXCLUDE_SENDERS.length; ex++) {
          if (lowerFrom.indexOf(CONFIG.EXCLUDE_SENDERS[ex]) >= 0) {
            // Özel durum: Onur gibi önemli forwarder'lar exclude edilmemeli
            var isImportantForwarder = false;
            for (var fw = 0; fw < CONFIG.IMPORTANT_FORWARDERS.length; fw++) {
              if (lowerFrom.indexOf(CONFIG.IMPORTANT_FORWARDERS[fw]) >= 0) {
                isImportantForwarder = true;
                break;
              }
            }
            if (!isImportantForwarder) {
              skipSender = true;
              break;
            }
          }
        }
        if (skipSender) continue;

        // 2. Subject exclude (expense report, toplantı daveti vs.)
        var skipSubject = false;
        for (var sx = 0; sx < CONFIG.EXCLUDE_SUBJECTS.length; sx++) {
          if (lowerSubject.indexOf(CONFIG.EXCLUDE_SUBJECTS[sx]) >= 0) {
            skipSubject = true;
            break;
          }
        }
        if (skipSubject) continue;

        // 3. Keyword exclude (newsletter, unsubscribe vs.)
        if (CONFIG.EXCLUDE_KEYWORDS.some(k => lowerAll.includes(k))) continue;

        // 4. Sent by me kontrolü — Gmail'de "from:me" olan mailleri atla
        // (dogukan@212.vc zaten exclude_senders'da ama ek güvenlik)

        // 5. Ödenmiş fatura tespiti
        var isAlreadyPaid = false;
        for (var ap = 0; ap < CONFIG.ALREADY_PAID_INDICATORS.length; ap++) {
          if (lowerAll.indexOf(CONFIG.ALREADY_PAID_INDICATORS[ap]) >= 0) {
            isAlreadyPaid = true;
            break;
          }
        }

        // 6. Önemli forwarder kontrolü (Onur)
        var isFromImportantForwarder = false;
        for (var fw = 0; fw < CONFIG.IMPORTANT_FORWARDERS.length; fw++) {
          if (lowerFrom.indexOf(CONFIG.IMPORTANT_FORWARDERS[fw]) >= 0) {
            isFromImportantForwarder = true;
            break;
          }
        }

        // PDF eklerini analiz et
        const pdfResults = [];
        for (const att of attachments) {
          if (att.getContentType() === "application/pdf" ||
              att.getName().toLowerCase().endsWith(".pdf")) {

            var pdfAnalysis;
            if (pdfProcessedCount < PDF_LIMIT) {
              pdfAnalysis = analyzePdf(att);
              pdfProcessedCount++;
            } else {
              pdfAnalysis = { isInvoice: false, failed: true, text: "",
                error: "PDF limiti aşıldı (" + PDF_LIMIT + "), sonraki taramada işlenecek",
                summary: att.getName() + ": ⏳ Sırada" };
            }
            pdfResults.push(pdfAnalysis);

            // Okunamayan PDF'leri kaydet
            if (pdfAnalysis.failed) {
              unreadablePdfs.push({
                date: msg.getDate(),
                from: from,
                subject: subject,
                fileName: att.getName(),
                error: pdfAnalysis.error,
                permalink: `https://mail.google.com/mail/u/0/#inbox/${thread.getId()}`
              });
            }
          }
        }

        // Fatura skoru hesapla
        const score = calculateInvoiceScore(subject, body, from, pdfResults);

        if (score >= 2) {
          // === KLASİK ANALİZ (her zaman çalışır) ===
          var vendorGuess = guessVendor(from, subject, body, pdfResults);
          var amountGuess = extractAmount(body, pdfResults);
          var currencyGuess = extractCurrency(body, pdfResults);
          var invoiceNoGuess = extractInvoiceNumber(subject, body, pdfResults);

          // === GEMİNİ AI İLE ZENGİNLEŞTİRME ===
          // Önce PDF'deki Gemini sonucunu kontrol et
          var bestGemini = null;
          for (var gi = 0; gi < pdfResults.length; gi++) {
            if (pdfResults[gi].gemini && pdfResults[gi].gemini.confidence > 0) {
              if (!bestGemini || pdfResults[gi].gemini.confidence > bestGemini.confidence) {
                bestGemini = pdfResults[gi].gemini;
              }
            }
          }

          // PDF'de Gemini yoksa ve mail body yeterince uzunsa, body'yi analiz et
          if (!bestGemini && isGeminiAvailable() && body.length > 100) {
            try {
              bestGemini = analyzeWithGemini(body.substring(0, 4000), from, subject);
            } catch (gemErr) {
              Logger.log("Gemini mail analiz hatası: " + gemErr.message);
            }
          }

          // Gemini sonuçlarıyla klasik sonuçları birleştir
          // Kural: Gemini yüksek güvenle sonuç verdiyse, klasik sonucu override et
          // Klasik sonuç boşsa, Gemini'den al
          if (bestGemini && bestGemini.confidence >= 60) {
            // Vendor: Gemini'nin tahmini bilinen vendor listesinde mi?
            if (bestGemini.vendor) {
              var geminiVendorKnown = false;
              for (var kv = 0; kv < ALL_KNOWN_VENDORS.length; kv++) {
                if (vendorMatch(bestGemini.vendor, ALL_KNOWN_VENDORS[kv])) {
                  vendorGuess = ALL_KNOWN_VENDORS[kv];  // Bilinen ismi kullan
                  geminiVendorKnown = true;
                  break;
                }
              }
              // Bilinen değilse ve klasik "Bilinmeyen" ise, Gemini'nin tahminini kullan
              if (!geminiVendorKnown && (vendorGuess === "Bilinmeyen" || !vendorGuess)) {
                vendorGuess = bestGemini.vendor;
              }
            }

            // Tutar: Klasik boşsa Gemini'den al
            if (!amountGuess && bestGemini.amount) {
              amountGuess = bestGemini.amount;
            }

            // Para birimi: Klasik boşsa Gemini'den al
            if (!currencyGuess && bestGemini.currency) {
              currencyGuess = bestGemini.currency;
            }

            // Fatura numarası: Klasik boşsa Gemini'den al
            if (!invoiceNoGuess && bestGemini.invoiceNo) {
              invoiceNoGuess = bestGemini.invoiceNo;
            }

            // Gemini fatura değil diyorsa ve skor düşükse, atla
            if (!bestGemini.isInvoice && bestGemini.confidence >= 80 && score < 5) {
              continue;
            }
          }

          // Yeni vendor kontrolü
          const isNewVendor = !isKnownVendor(vendorGuess);
          if (isNewVendor && vendorGuess !== "Bilinmeyen") {
            newVendors.push({
              vendor: vendorGuess,
              from: from,
              subject: subject,
              date: msg.getDate(),
              permalink: `https://mail.google.com/mail/u/0/#inbox/${thread.getId()}`
            });
          }

          // Zaten ödenmiş faturaları atla (Zoho "Payment Made" vs.)
          if (isAlreadyPaid) continue;

          // AI özet bilgisini pdfDetails'a ekle
          var pdfDetailsStr = pdfResults.map(p => p.summary).join(" | ");
          if (bestGemini && bestGemini.summary) {
            pdfDetailsStr += (pdfDetailsStr ? " | " : "") + "🤖 " + bestGemini.summary;
          }

          invoices.push({
            date: msg.getDate(),
            from: from,
            subject: subject,
            messageId: msgId,
            threadId: thread.getId(),
            score: isFromImportantForwarder ? score + 2 : score,  // Onur forward = +2 skor
            vendor: vendorGuess,
            amount: amountGuess,
            currency: currencyGuess,
            invoiceNo: normalizeInvoiceNo(invoiceNoGuess),
            hasPdf: pdfResults.length > 0,
            pdfIsInvoice: pdfResults.some(p => p.isInvoice),
            pdfDetails: pdfDetailsStr,
            isNewVendor: isNewVendor,
            isForwarded: isFromImportantForwarder,
            permalink: `https://mail.google.com/mail/u/0/#inbox/${thread.getId()}`
          });
        }
      }
    }
  }

  invoices.sort((a, b) => b.score - a.score);
  return { invoices, unreadablePdfs, newVendors };
}
/**
 * PDF içeriğini okur ve fatura olup olmadığını analiz eder
 * Drive API v3 kullanır
 */
function analyzePdf(attachment) {
  const fileName = attachment.getName();
  var tempFileIds = []; // Silinecek tüm geçici dosyaları takip et

  try {
    const blob = attachment.copyBlob();

    // Boyut kontrolü (10MB üstü atla)
    if (blob.getBytes().length > 10 * 1024 * 1024) {
      return {
        isInvoice: false, failed: true, text: "",
        error: "Dosya çok büyük (>10MB)",
        summary: fileName + ": ⚠️ Çok büyük dosya"
      };
    }

    var text = "";

    // YÖNTEM 1: Drive API v3 — PDF'i Google Docs olarak yükle (otomatik OCR)
    try {
      var file = Drive.Files.create(
        { name: "temp_ocr_" + Date.now(), mimeType: "application/vnd.google-apps.document" },
        blob,
        { fields: "id" }
      );
      tempFileIds.push(file.id);

      // Google Docs olarak metin oku
      var doc = DocumentApp.openById(file.id);
      text = doc.getBody().getText();
    } catch (e1) {
      // YÖNTEM 2: DriveApp ile yükle, sonra Docs'a kopyala
      try {
        var tempPdf = DriveApp.createFile(blob.setName("temp_ocr_" + Date.now() + ".pdf"));
        tempFileIds.push(tempPdf.getId());

        // PDF'i Google Docs formatına kopyala (Drive API v3)
        var docFile = Drive.Files.copy(
          { name: "temp_ocr_doc_" + Date.now(), mimeType: "application/vnd.google-apps.document" },
          tempPdf.getId(),
          { fields: "id" }
        );
        tempFileIds.push(docFile.id);

        var doc = DocumentApp.openById(docFile.id);
        text = doc.getBody().getText();
      } catch (e2) {
        // YÖNTEM 3: Basit blob text extraction
        try {
          text = blob.getDataAsString();
        } catch (e3) {
          // Son çare: PDF binary'den text çıkarmayı dene
          try {
            var bytes = blob.getBytes();
            var rawText = "";
            for (var i = 0; i < bytes.length && i < 50000; i++) {
              var c = bytes[i];
              if (c >= 32 && c <= 126) rawText += String.fromCharCode(c);
              else if (c === 10 || c === 13) rawText += " ";
            }
            // PDF stream'lerden metin parçalarını çıkar
            var textMatches = rawText.match(/\(([^)]{3,})\)/g);
            if (textMatches) {
              text = textMatches.map(function(m) { return m.slice(1, -1); }).join(" ");
            }
          } catch (e4) {
            // Tüm yöntemler başarısız
          }
        }
      }
    }

    // Tüm geçici dosyaları temizle
    for (var t = 0; t < tempFileIds.length; t++) {
      try { DriveApp.getFileById(tempFileIds[t]).setTrashed(true); } catch (e) {}
    }

    // Text kontrol
    if (!text || text.trim().length < 20) {
      return {
        isInvoice: false, failed: true, text: "",
        error: "İçerik boş veya çok kısa (tüm yöntemler denendi)",
        summary: fileName + ": 🔴 OKUNAMADI"
      };
    }

    var lowerText = text.toLowerCase();

    // === KLASIK KEYWORD ANALİZİ (her zaman çalışır, fallback) ===
    var invoiceIndicators = [
      "invoice", "fatura", "rechnung", "facture",
      "tax invoice", "total", "subtotal", "vat", "kdv",
      "amount due", "payment", "bank account", "iban",
      "invoice number", "invoice no", "fatura no",
      "due date", "vade", "toplam", "net amount",
      "bill to", "remittance", "wire transfer"
    ];

    var matchCount = 0;
    for (var i = 0; i < invoiceIndicators.length; i++) {
      if (lowerText.indexOf(invoiceIndicators[i]) >= 0) matchCount++;
    }
    var isInvoiceKeyword = matchCount >= 3;

    // === GEMİNİ AI ANALİZİ (varsa) ===
    var geminiResult = null;
    if (isGeminiAvailable()) {
      try {
        geminiResult = analyzeWithGemini(text.substring(0, 4000), "", fileName);
      } catch (gemErr) {
        Logger.log("Gemini PDF analiz hatası: " + gemErr.message);
      }
    }

    // Sonuçları birleştir: Gemini varsa ona güven, yoksa klasik yöntem
    var isInvoice, summaryText;
    if (geminiResult && geminiResult.confidence > 0) {
      // Gemini başarılı — her iki sonucu birleştir
      isInvoice = geminiResult.confidence >= 60 ? true : (geminiResult.confidence >= 40 ? isInvoiceKeyword : false);
      summaryText = fileName + ": " + (isInvoice ? "✅ FATURA" : "❓ Belirsiz")
        + " (AI:" + geminiResult.confidence + "%, kw:" + matchCount + ")"
        + (geminiResult.summary ? " — " + geminiResult.summary : "");
    } else {
      // Gemini yok veya hata — klasik yöntem
      isInvoice = isInvoiceKeyword;
      summaryText = fileName + ": " + (isInvoice ? "✅ FATURA" : "❓ Belirsiz") + " (" + matchCount + " eşleşme)";
    }

    return {
      isInvoice: isInvoice,
      failed: false,
      text: text.substring(0, 3000),
      summary: summaryText,
      matchCount: matchCount,
      gemini: geminiResult  // AI sonucu — scanGmail'de kullanılacak
    };

  } catch (e) {
    // Hata durumunda da geçici dosyaları temizle
    for (var t = 0; t < tempFileIds.length; t++) {
      try { DriveApp.getFileById(tempFileIds[t]).setTrashed(true); } catch (cleanupErr) {}
    }
    return {
      isInvoice: false, failed: true, text: "",
      error: "Beklenmeyen hata: " + e.message,
      summary: fileName + ": 🔴 HATA"
    };
  }
}
/**
 * Fatura olma olasılığını skorlar (0-10)
 */
function calculateInvoiceScore(subject, body, from, pdfResults) {
  let score = 0;
  const lowerSubject = subject.toLowerCase();
  const lowerBody = body.toLowerCase();
  const lowerFrom = from.toLowerCase();

  if (CONFIG.INVOICE_KEYWORDS.some(k => lowerSubject.includes(k))) score += 3;
  if (CONFIG.INVOICE_KEYWORDS.some(k => lowerBody.includes(k))) score += 2;
  if (CONFIG.VENDOR_DOMAINS.some(d => lowerFrom.includes(d))) score += 2;
  if (pdfResults.length > 0) score += 1;
  if (pdfResults.some(p => p.isInvoice)) score += 3;
  if (/[\€\$\£]\s*[\d,]+\.?\d*|[\d,]+\.?\d*\s*(EUR|USD|TRY|AED|GBP|CHF)/i.test(body)) score += 1;

  return score;
}
/**
 * Vendor bilinen mi kontrol et
 */
function isKnownVendor(vendorName) {
  if (!vendorName || vendorName === "Bilinmeyen") return false;
  for (var k = 0; k < ALL_KNOWN_VENDORS.length; k++) {
    if (vendorMatch(vendorName, ALL_KNOWN_VENDORS[k])) return true;
  }
  return false;
}
/**
 * Vendor ismini tahmin eder
 */
function guessVendor(from, subject, body, pdfResults) {
  const fromMatch = from.match(/"?([^"<]+)"?\s*</);
  if (fromMatch) {
    const name = fromMatch[1].trim();
    // vendorMatch kullanarak tutarlı eşleştirme
    for (var i = 0; i < ALL_KNOWN_VENDORS.length; i++) {
      if (vendorMatch(name, ALL_KNOWN_VENDORS[i])) {
        return ALL_KNOWN_VENDORS[i];
      }
    }
    return name;
  }
  const emailMatch = from.match(/@([^>]+)/);
  if (emailMatch) return emailMatch[1].split(".")[0];
  return "Bilinmeyen";
}
/**
 * Tutarı çıkarır
 */
function extractAmount(body, pdfResults) {
  const allText = body + " " + pdfResults.map(p => p.text || "").join(" ");
  const patterns = [
    /amount\s*due[:\s]*[\€\$\£]?\s*([\d.,]+)/i,    // En güvenilir
    /genel\s*toplam[:\s]*[\€\$\£]?\s*([\d.,]+)/i,
    /balance\s*due[:\s]*[\€\$\£]?\s*([\d.,]+)/i,
    /toplam[:\s]*[\€\$\£]?\s*([\d.,]+)/i,
    /total[:\s]*[\€\$\£]?\s*([\d.,]+)/i,            // En son (subtotal yakalayabilir)
    /([\d.,]+)\s*(EUR|USD|TRY|AED|GBP|CHF)/i
  ];
  for (const pattern of patterns) {
    const match = allText.match(pattern);
    if (match) {
      var amount = match[1];
      // Avrupa formatı tespiti: 1.234,56 → 1234.56
      if (amount.indexOf(",") > amount.lastIndexOf(".") ||
          (amount.indexOf(",") >= 0 && amount.indexOf(".") < 0)) {
        // Virgül ondalık ayracı olabilir
        if (amount.match(/,\d{2}$/)) {
          // 1.234,56 veya 234,56 formatı
          amount = amount.replace(/\./g, "").replace(",", ".");
        }
      } else {
        // US formatı: 1,234.56
        amount = amount.replace(/,/g, "");
      }
      return amount;
    }
  }
  return "";
}
/**
 * Para birimini çıkarır
 */
function extractCurrency(body, pdfResults) {
  const allText = body + " " + pdfResults.map(p => p.text || "").join(" ");
  const match = allText.match(/(EUR|USD|TRY|AED|GBP|CHF|€|\$|£)/i);
  if (match) {
    const sym = match[1];
    if (sym === "€") return "EUR";
    if (sym === "$") return "USD";
    if (sym === "£") return "GBP";
    return sym.toUpperCase();
  }
  return "";
}
/**
 * Fatura numarasını normalize eder — cross-check eşleşme doğruluğu için
 * "Inv-00040326" → "INV00040326"
 * "TC-8425" → "TC8425"
 * " 20260461 " → "20260461"
 */
function normalizeInvoiceNo(raw) {
  if (!raw) return "";
  var s = String(raw).trim().toUpperCase();
  s = s.replace(/[\s\-\/\.]+/g, "");
  return s;
}
/**
 * Fatura numarasını çıkarır
 */
function extractInvoiceNumber(subject, body, pdfResults) {
  // Önce subject'ten çıkarmayı dene (en güvenilir kaynak)
  // TC8425, 20260461, 16000939, 402777 gibi pattern'ler
  var subjectPatterns = [
    /\b(TC\d{3,})\b/i,                          // TC8425, TC8477
    /\b(\d{7,})\b/,                               // 20260461, 16000939
    /\b([A-Z]{2}\d{4,})\b/,                       // PL5213852971
    /\b(\d{4,}\-\d+)\b/,                          // 212VC-Feb2026
    /invoice[:\s\-]*([A-Z0-9\-\/]{4,})/i,         // Invoice - 801700322021
    /fatura[:\s\-]*([A-Z0-9\-\/]{4,})/i
  ];

  for (var i = 0; i < subjectPatterns.length; i++) {
    var match = subject.match(subjectPatterns[i]);
    if (match) {
      var candidate = match[1];
      // False positive kontrolü — bu kelimeler fatura no değil
      var badWords = ["description", "date", "total", "amount", "invoice", "fatura",
                      "service", "payment", "period", "entity", "oice", "http", "https",
                      "from", "subject", "sent", "received"];
      var isBad = false;
      for (var b = 0; b < badWords.length; b++) {
        if (candidate.toLowerCase() === badWords[b]) { isBad = true; break; }
      }
      if (!isBad && candidate.length >= 3) return candidate;
    }
  }

  // Sonra body'den dene
  var bodyPatterns = [
    /invoice\s*(?:#|no\.?|number)[:\s]*([A-Z0-9\-\/]{3,})/i,
    /fatura\s*(?:#|no\.?|numar)[:\s]*([A-Z0-9\-\/]{3,})/i,
    /\b(TC\d{3,})\b/i,
    /reference[:\s]*([A-Z0-9\-\/]{4,})/i
  ];

  for (var i = 0; i < bodyPatterns.length; i++) {
    var match = body.match(bodyPatterns[i]);
    if (match && match[1].length >= 3 && match[1].length <= 30) {
      return match[1];
    }
  }

  // Son olarak PDF içeriğinden
  for (var p = 0; p < pdfResults.length; p++) {
    var pdfText = pdfResults[p].text || "";
    if (!pdfText) continue;

    for (var i = 0; i < bodyPatterns.length; i++) {
      var match = pdfText.match(bodyPatterns[i]);
      if (match && match[1].length >= 3 && match[1].length <= 30) {
        return match[1];
      }
    }
  }

  return "";
}
// ==================== SHEET YAZMA İŞLEMLERİ ====================
function getOrCreateSpreadsheet() {
  const props = PropertiesService.getScriptProperties();
  let ssId = props.getProperty("TRACKER_SS_ID");
  if (ssId) {
    try { return SpreadsheetApp.openById(ssId); } catch (e) {}
  }
  const ss = SpreadsheetApp.create("212 Invoice Tracker");
  props.setProperty("TRACKER_SS_ID", ss.getId());
  setupSheets(ss);
  return ss;
}
function setupSheets(ss) {
  const sheets = [
    { name: CONFIG.SHEET_FOUND, headers: [
      "Tarih", "Gönderen", "Konu", "Vendor (Tahmin)", "Fatura No",
      "Tutar", "Para Birimi", "PDF?", "PDF Fatura?", "Skor", "Yeni Vendor?",
      "PDF Detay", "Mail Link", "İşlendi?", "Notlar"
    ]},
    { name: CONFIG.SHEET_UNREADABLE, headers: [
      "Tarih", "Gönderen", "Konu", "PDF Dosya Adı", "Hata Sebebi", "Mail Link", "Manuel Kontrol?"
    ]},
    { name: CONFIG.SHEET_NEW_VENDORS, headers: [
      "Tarih", "Vendor Adı", "Gönderen", "Konu", "Mail Link", "Vendorlar Listesine Eklendi?"
    ]},
    { name: CONFIG.SHEET_VENDORS, headers: [
      "Ay", "Beklenen Vendor", "Bu Ay Geldi?", "Aksiyon"
    ]},
    { name: CONFIG.SHEET_CROSSCHECK, headers: [
      "Fatura No (Gmail)", "Vendor (Gmail)", "Tarih (Gmail)",
      "Excelde Var?", "Durum"
    ]},
    { name: CONFIG.SHEET_KNOWN_INVOICES, headers: [
      "Fatura No", "Vendor", "Tarih", "Tutar", "Status", "Kaynak"
    ]},
    { name: CONFIG.SHEET_LOG, headers: ["Zaman", "Mesaj"] }
  ];

  const defaultSheet = ss.getSheets()[0];
  defaultSheet.setName(sheets[0].name);

  for (let i = 0; i < sheets.length; i++) {
    let sheet = (i === 0) ? defaultSheet : ss.insertSheet(sheets[i].name);
    const headerRange = sheet.getRange(1, 1, 1, sheets[i].headers.length);
    headerRange.setValues([sheets[i].headers]);
    headerRange.setFontWeight("bold");
    headerRange.setBackground("#1F4E79");
    headerRange.setFontColor("#FFFFFF");
    headerRange.setWrap(true);
    sheet.setFrozenRows(1);

    // Sütun genişlikleri
    for (let c = 1; c <= sheets[i].headers.length; c++) {
      sheet.setColumnWidth(c, 140);
    }
  }
}
function writeFoundInvoices(ss, invoices) {
  let sheet = ss.getSheetByName(CONFIG.SHEET_FOUND);
  if (!sheet) { setupSheets(ss); sheet = ss.getSheetByName(CONFIG.SHEET_FOUND); }

  const existingData = sheet.getDataRange().getValues();
  const existingLinks = new Set();
  for (let i = 1; i < existingData.length; i++) {
    if (existingData[i][12]) existingLinks.add(existingData[i][12]);
  }

  // Yeni faturaları topla
  var newRows = [];
  var newRowMeta = []; // renk bilgileri
  for (const inv of invoices) {
    if (existingLinks.has(inv.permalink)) continue;
    newRows.push([
      inv.date, inv.from, inv.subject, inv.vendor, inv.invoiceNo,
      inv.amount, inv.currency,
      inv.hasPdf ? "✅" : "❌",
      inv.pdfIsInvoice ? "✅ Fatura" : (inv.hasPdf ? "❓ Belirsiz" : "—"),
      inv.score,
      inv.isNewVendor ? "🆕 YENİ" : (inv.isForwarded ? "📨 FWD" : ""),
      inv.pdfDetails, inv.permalink, "", ""
    ]);
    newRowMeta.push({ isNew: inv.isNewVendor, highScore: inv.score >= 7 });
  }

  if (newRows.length === 0) return 0;

  // Batch yazma
  var startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, newRows.length, 15).setValues(newRows);

  // Renklendirme
  sheet.getRange(startRow, 1, newRows.length, 15).setBackground("#FFFDE7");
  for (var i = 0; i < newRowMeta.length; i++) {
    if (newRowMeta[i].isNew) {
      sheet.getRange(startRow + i, 4, 1, 1).setBackground("#F4B084");
      sheet.getRange(startRow + i, 11, 1, 1).setBackground("#F4B084");
    }
    if (newRowMeta[i].highScore) {
      sheet.getRange(startRow + i, 10, 1, 1).setBackground("#C6EFCE");
    }
  }

  return newRows.length;
}
function writeUnreadablePdfs(ss, unreadablePdfs) {
  let sheet = ss.getSheetByName(CONFIG.SHEET_UNREADABLE);
  if (!sheet) return;

  const existingData = sheet.getDataRange().getValues();
  const existingLinks = new Set();
  for (let i = 1; i < existingData.length; i++) {
    if (existingData[i][5]) existingLinks.add(existingData[i][5] + "|" + existingData[i][3]);
  }

  var newRows = [];
  for (const pdf of unreadablePdfs) {
    const key = pdf.permalink + "|" + pdf.fileName;
    if (existingLinks.has(key)) continue;
    newRows.push([pdf.date, pdf.from, pdf.subject, pdf.fileName, pdf.error, pdf.permalink, ""]);
  }

  if (newRows.length === 0) return;
  var startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, newRows.length, 7).setValues(newRows);
  sheet.getRange(startRow, 1, newRows.length, 7).setBackground("#FFC7CE");
}
function writeNewVendors(ss, newVendors) {
  let sheet = ss.getSheetByName(CONFIG.SHEET_NEW_VENDORS);
  if (!sheet) return;

  const existingData = sheet.getDataRange().getValues();
  const existingVendors = new Set();
  for (let i = 1; i < existingData.length; i++) {
    if (existingData[i][1]) existingVendors.add(existingData[i][1]);
  }

  var newRows = [];
  for (const nv of newVendors) {
    if (existingVendors.has(nv.vendor)) continue;
    newRows.push([nv.date, nv.vendor, nv.from, nv.subject, nv.permalink, ""]);
  }

  if (newRows.length === 0) return;
  var startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, newRows.length, 6).setValues(newRows);
  sheet.getRange(startRow, 1, newRows.length, 6).setBackground("#FFF2CC");
}
function crossCheck(ss, invoices) {
  let checkSheet = ss.getSheetByName(CONFIG.SHEET_CROSSCHECK);
  if (!checkSheet) return;

  const knownSheet = ss.getSheetByName(CONFIG.SHEET_KNOWN_INVOICES);
  if (!knownSheet) return;

  const knownData = knownSheet.getDataRange().getValues();
  const knownInvoiceNos = new Set();
  for (let i = 1; i < knownData.length; i++) {
    if (knownData[i][0]) knownInvoiceNos.add(normalizeInvoiceNo(knownData[i][0]));
  }

  const toCheck = invoices.filter(inv => inv.invoiceNo);
  if (toCheck.length === 0) return;

  const lastRow = checkSheet.getLastRow();
  if (lastRow > 1) checkSheet.getRange(2, 1, lastRow - 1, 5).clearContent();

  var rows = [];
  var redRows = []; // kırmızı olacak satır indeksleri
  for (var i = 0; i < toCheck.length; i++) {
    var inv = toCheck[i];
    var inExcel = knownInvoiceNos.has(normalizeInvoiceNo(inv.invoiceNo));
    rows.push([
      inv.invoiceNo, inv.vendor, inv.date,
      inExcel ? "✅ Evet" : "❌ HAYIR",
      inExcel ? "Tamam" : "⚠️ Excelde yok — kontrol et!"
    ]);
    if (!inExcel) redRows.push(i);
  }

  if (rows.length > 0) {
    checkSheet.getRange(2, 1, rows.length, 5).setValues(rows);
    for (var r = 0; r < redRows.length; r++) {
      checkSheet.getRange(2 + redRows[r], 1, 1, 5).setBackground("#FFC7CE");
    }
  }
}
function checkMissingVendors(ss, foundInvoices) {
  let vendorSheet = ss.getSheetByName(CONFIG.SHEET_VENDORS);
  if (!vendorSheet) return [];

  const currentMonth = new Date().getMonth() + 1;
  const monthNames = ["","Ocak","Şubat","Mart","Nisan","Mayıs","Haziran",
                       "Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"];

  const expectedVendors = MONTHLY_VENDOR_PATTERN[currentMonth] || [];
  const foundVendorsList = foundInvoices.map(inv => inv.vendor);

  // Bilinen faturalar sheet'inden de kontrol
  const knownSheet = ss.getSheetByName(CONFIG.SHEET_KNOWN_INVOICES);
  if (knownSheet) {
    const knownData = knownSheet.getDataRange().getValues();
    const currentYear = new Date().getFullYear();
    for (let i = 1; i < knownData.length; i++) {
      const date = knownData[i][2];
      if (date instanceof Date && date.getMonth() + 1 === currentMonth && date.getFullYear() === currentYear) {
        foundVendorsList.push(knownData[i][1]);
      }
    }
  }

  const lastRow = vendorSheet.getLastRow();
  if (lastRow > 1) vendorSheet.getRange(2, 1, lastRow - 1, 4).clearContent();

  const missingVendors = [];
  var rows = [];
  var redRows = [];

  for (var v = 0; v < expectedVendors.length; v++) {
    var vendor = expectedVendors[v];
    // Tutarlı matching — isKnownVendor ile aynı mantık
    var found = false;
    for (var f = 0; f < foundVendorsList.length; f++) {
      if (vendorMatch(vendor, foundVendorsList[f])) {
        found = true;
        break;
      }
    }

    rows.push([
      monthNames[currentMonth],
      vendor,
      found ? "✅ Geldi" : "⚠️ Henüz yok",
      found ? "" : "📧 Mail kutusunu kontrol et!"
    ]);

    if (!found) {
      redRows.push(v);
      missingVendors.push(vendor);
    }
  }

  if (rows.length > 0) {
    vendorSheet.getRange(2, 1, rows.length, 4).setValues(rows);
    for (var r = 0; r < redRows.length; r++) {
      vendorSheet.getRange(2 + redRows[r], 1, 1, 4).setBackground("#FFC7CE");
    }
  }

  return missingVendors;
}
/**
 * Tutarlı vendor eşleştirme — isKnownVendor, guessVendor ve checkMissingVendors
 * hepsi bu fonksiyonu kullanır.
 */
function vendorMatch(vendorA, vendorB) {
  if (!vendorA || !vendorB) return false;
  var a = String(vendorA).toLowerCase().trim();
  var b = String(vendorB).toLowerCase().trim();
  if (a === b) return true;

  var skipWords = ["the", "a", "an", "de", "van", "von", "al"];

  function getKeyWord(str) {
    var words = str.split(/\s+/);
    for (var i = 0; i < words.length; i++) {
      if (skipWords.indexOf(words[i]) < 0 && words[i].length >= 4) {
        return words[i];
      }
    }
    return "";
  }

  var keyA = getKeyWord(a);
  var keyB = getKeyWord(b);

  if (keyA && keyB && keyA.length >= 4 && keyB.length >= 4) {
    return keyA === keyB || a.indexOf(keyB) >= 0 || b.indexOf(keyA) >= 0;
  }
  return false;
}
// ==================== BİLDİRİM MAİLİ ====================
/**
 * HTML escape — dış kaynaklı stringleri güvenli yapar
 */
function escapeHtml(s) {
  return String(s || "").replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
/**
 * Sabah özet bildirim maili gönderir
 */
function sendNotificationEmail(ss, summary) {
  const email = CONFIG.NOTIFICATION_EMAIL || Session.getActiveUser().getEmail();
  const sheetUrl = ss.getUrl();
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd.MM.yyyy");

  let subject = `🧾 Fatura Tracker — ${today}`;

  // Acil durum varsa subject'te belirt
  const urgentItems = [];
  if (summary.unreadablePdfs.length > 0) urgentItems.push(`${summary.unreadablePdfs.length} okunamayan PDF`);
  if (summary.newVendors.length > 0) urgentItems.push(`${summary.newVendors.length} yeni vendor`);
  if (summary.missingVendors.length > 0) urgentItems.push(`${summary.missingVendors.length} eksik vendor`);

  if (urgentItems.length > 0) {
    subject += ` ⚠️ ${urgentItems.join(", ")}`;
  }

  // HTML mail gövdesi
  let html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
      <div style="background:#1F4E79;color:white;padding:16px 20px;border-radius:8px 8px 0 0;">
        <h2 style="margin:0;font-size:18px;">🧾 212 Invoice Tracker — Günlük Özet</h2>
        <p style="margin:4px 0 0;opacity:0.8;font-size:13px;">${today} ${isGeminiAvailable() ? "| 🤖 Gemini AI aktif" : ""}</p>
      </div>

      <div style="border:1px solid #ddd;border-top:none;padding:20px;border-radius:0 0 8px 8px;">

        <!-- ÖZET SAYILAR -->
        <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
          <tr>
            <td style="text-align:center;padding:12px;background:#E8F4FD;border-radius:6px;">
              <div style="font-size:24px;font-weight:bold;color:#1F4E79;">${summary.newInvoices}</div>
              <div style="font-size:12px;color:#666;">Yeni Fatura</div>
            </td>
            <td style="width:8px;"></td>
            <td style="text-align:center;padding:12px;background:${summary.unreadablePdfs.length > 0 ? '#FFC7CE' : '#E8F4FD'};border-radius:6px;">
              <div style="font-size:24px;font-weight:bold;color:${summary.unreadablePdfs.length > 0 ? '#8B0000' : '#1F4E79'};">${summary.unreadablePdfs.length}</div>
              <div style="font-size:12px;color:#666;">Okunamayan PDF</div>
            </td>
            <td style="width:8px;"></td>
            <td style="text-align:center;padding:12px;background:${summary.missingVendors.length > 0 ? '#FFEB9C' : '#E8F4FD'};border-radius:6px;">
              <div style="font-size:24px;font-weight:bold;color:${summary.missingVendors.length > 0 ? '#8B6914' : '#1F4E79'};">${summary.missingVendors.length}</div>
              <div style="font-size:12px;color:#666;">Eksik Vendor</div>
            </td>
          </tr>
        </table>`;

  // OKUNAMAYAN PDF'LER
  if (summary.unreadablePdfs.length > 0) {
    html += `
        <div style="background:#FFC7CE;padding:12px 16px;border-radius:6px;margin-bottom:16px;">
          <h3 style="margin:0 0 8px;color:#8B0000;font-size:14px;">🔴 Okunamayan PDF'ler — Manuel Kontrol Gerekli</h3>
          <table style="width:100%;font-size:12px;">`;

    for (const pdf of summary.unreadablePdfs) {
      html += `
            <tr>
              <td style="padding:4px 0;"><strong>${escapeHtml(pdf.fileName)}</strong></td>
              <td style="padding:4px 0;color:#666;">${escapeHtml(pdf.error)}</td>
              <td style="padding:4px 0;"><a href="${escapeHtml(pdf.permalink)}" style="color:#1F4E79;">Maili Aç</a></td>
            </tr>`;
    }

    html += `</table></div>`;
  }

  // YENİ VENDOR'LAR
  if (summary.newVendors.length > 0) {
    html += `
        <div style="background:#FFF2CC;padding:12px 16px;border-radius:6px;margin-bottom:16px;">
          <h3 style="margin:0 0 8px;color:#8B6914;font-size:14px;">🆕 Yeni Vendor'lar — İlk Kez Fatura Gönderen</h3>
          <ul style="margin:0;padding-left:20px;font-size:12px;">`;

    for (const nv of summary.newVendors) {
      html += `<li><strong>${escapeHtml(nv.vendor)}</strong> — <a href="${escapeHtml(nv.permalink)}" style="color:#1F4E79;">Maili Aç</a></li>`;
    }

    html += `</ul></div>`;
  }

  // EKSİK VENDOR'LAR
  if (summary.missingVendors.length > 0) {
    html += `
        <div style="background:#FFEB9C;padding:12px 16px;border-radius:6px;margin-bottom:16px;">
          <h3 style="margin:0 0 8px;color:#8B6914;font-size:14px;">⚠️ Bu Ay Beklenen Ama Henüz Gelmeyen Vendor'lar</h3>
          <ul style="margin:0;padding-left:20px;font-size:12px;">`;

    for (const v of summary.missingVendors) {
      html += `<li>${escapeHtml(v)}</li>`;
    }

    html += `</ul>
          <p style="font-size:11px;color:#666;margin:8px 0 0;">Bu vendor'lardan geçmiş yıllarda bu ayda fatura gelmiştir. Mail kutusunu kontrol et veya vendor'a sor.</p>
        </div>`;
  }

  // FOOTER
  html += `
        <div style="text-align:center;margin-top:20px;">
          <a href="${sheetUrl}" style="display:inline-block;background:#1F4E79;color:white;padding:10px 24px;border-radius:6px;text-decoration:none;font-size:14px;">📊 Tracker Sheet'i Aç</a>
        </div>

        <p style="font-size:11px;color:#999;text-align:center;margin-top:16px;">
          Bu mail 212 Invoice Tracker tarafından otomatik gönderilmiştir.
        </p>
      </div>
    </div>`;

  MailApp.sendEmail({
    to: email,
    subject: subject,
    htmlBody: html
  });

  log(getOrCreateSpreadsheet(), `📩 Bildirim maili gönderildi: ${email}`);
}
/**
 * Hata bildirimi
 */
function sendErrorNotification(errorMessage) {
  const email = CONFIG.NOTIFICATION_EMAIL || Session.getActiveUser().getEmail();
  MailApp.sendEmail({
    to: email,
    subject: "🔴 Invoice Tracker HATA",
    body: `Invoice Tracker çalışırken hata oluştu:\n\n${errorMessage}\n\nApps Script editöründen kontrol edin.`
  });
}
// ==================== ONAY MAİLİ TASLAK OLUŞTURUCU ====================
/**
 * Sheet'teki seçili satırlardan onay maili taslağı oluşturur
 * Kullanım: Sheet'te satırları seç → Menü → Onay Maili Oluştur
 */
function createApprovalDraft() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEET_FOUND);
  if (!sheet) {
    SpreadsheetApp.getUi().alert("'📧 Bulunan Faturalar' sekmesi bulunamadı.");
    return;
  }

  const selection = sheet.getActiveRange();
  if (!selection) {
    SpreadsheetApp.getUi().alert("Lütfen onay almak istediğiniz fatura satırlarını seçin.");
    return;
  }

  const startRow = selection.getRow();
  const numRows = selection.getNumRows();

  if (startRow < 2) {
    SpreadsheetApp.getUi().alert("Lütfen header satırını değil, data satırlarını seçin.");
    return;
  }

  // Seçili satırların verisini al
  const data = sheet.getRange(startRow, 1, numRows, 15).getValues();

  const invoices = [];
  for (const row of data) {
    if (!row[0]) continue; // Boş satır
    invoices.push({
      date: row[0] instanceof Date ? Utilities.formatDate(row[0], Session.getScriptTimeZone(), "dd.MM.yyyy") : row[0],
      vendor: row[3] || "—",
      invoiceNo: row[4] || "—",
      amount: row[5] || "—",
      currency: row[6] || "",
      subject: row[2] || ""
    });
  }

  if (invoices.length === 0) {
    SpreadsheetApp.getUi().alert("Seçili satırlarda fatura verisi bulunamadı.");
    return;
  }

  // Onay maili oluştur
  const approvalTo = CONFIG.APPROVAL_EMAIL_TO || "ONAY_ALACAK_KİŞİ@212.vc";
  const signature = CONFIG.APPROVAL_EMAIL_SIGNATURE || "Doğukan";

  let subject, body;

  if (invoices.length === 1) {
    const inv = invoices[0];
    subject = `${CONFIG.APPROVAL_EMAIL_SUBJECT_PREFIX}${inv.vendor} — ${inv.invoiceNo} — ${inv.amount} ${inv.currency}`;
    body = `Merhaba,\n\nAşağıdaki fatura için ödeme onayınızı rica ederim:\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Vendor: ${inv.vendor}\n` +
      `Fatura No: ${inv.invoiceNo}\n` +
      `Tarih: ${inv.date}\n` +
      `Tutar: ${inv.amount} ${inv.currency}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `Fatura PDF'i ekte yer almaktadır.\n\n` +
      `Onayınız halinde ödeme işlemi başlatılacaktır.\n\n` +
      `Saygılarımla,\n${signature}`;
  } else {
    subject = `${CONFIG.APPROVAL_EMAIL_SUBJECT_PREFIX}${invoices.length} Fatura — Toplu Onay`;
    body = `Merhaba,\n\nAşağıdaki ${invoices.length} fatura için ödeme onayınızı rica ederim:\n\n`;

    let totalByC = {};
    for (let i = 0; i < invoices.length; i++) {
      const inv = invoices[i];
      body += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      body += `${i + 1}. ${inv.vendor}\n`;
      body += `   Fatura No: ${inv.invoiceNo}\n`;
      body += `   Tarih: ${inv.date}\n`;
      body += `   Tutar: ${inv.amount} ${inv.currency}\n`;

      if (inv.amount && inv.currency) {
        const amt = parseFloat(String(inv.amount).replace(",", ""));
        if (!isNaN(amt)) {
          totalByC[inv.currency] = (totalByC[inv.currency] || 0) + amt;
        }
      }
    }

    body += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    const totals = Object.entries(totalByC).map(([c, t]) => `${t.toFixed(2)} ${c}`).join(" + ");
    if (totals) body += `Toplam: ${totals}\n\n`;

    body += `Fatura PDF'leri ekte yer almaktadır.\n\n`;
    body += `Onayınız halinde ödeme işlemleri başlatılacaktır.\n\n`;
    body += `Saygılarımla,\n${signature}`;
  }

  // Gmail'de draft oluştur
  GmailApp.createDraft(approvalTo, subject, body);

  // Seçili satırları "İşlendi" olarak işaretle
  for (let i = 0; i < numRows; i++) {
    sheet.getRange(startRow + i, 14).setValue("✅ Taslak oluşturuldu");
  }

  SpreadsheetApp.getUi().alert(
    "Onay Maili Taslağı Oluşturuldu ✅",
    `${invoices.length} fatura için Gmail taslağı oluşturuldu.\n\n` +
    `Gmail → Drafts klasöründen kontrol edip gönderin.\n\n` +
    `⚠️ PDF eklemeyi unutmayın!`,
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}
// ==================== YARDIMCI ====================
function log(ss, message) {
  const logSheet = ss.getSheetByName(CONFIG.SHEET_LOG);
  if (logSheet) logSheet.appendRow([new Date(), message]);
  Logger.log(message);
}
// ==================== EXCEL CROSS-CHECK (DRIVE'DAN OTO OKUMA) ====================
/**
 * Drive'daki Invoice Excel'ini bulur ve bilinen faturaları otomatik import eder.
 * Dosya adında "Invoice_Pending" geçen en son güncellenen dosyayı bulur.
 * Drive API v3 kullanır.
 */
function syncFromDriveExcel() {
  const ss = getOrCreateSpreadsheet();

  try {
    // Drive'da "Invoice_Pending" içeren dosyaları ara
    var files = DriveApp.searchFiles(
      'title contains "Invoice_Pending" and mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" and trashed = false'
    );

    if (!files.hasNext()) {
      files = DriveApp.searchFiles(
        'title contains "Pending_of_Authorization" and trashed = false'
      );
    }

    if (!files.hasNext()) {
      log(ss, "❌ Drive'da Invoice Excel bulunamadı.");
      return;
    }

    // En son güncellenen dosyayı bul
    var latestFile = null;
    var latestDate = new Date(0);

    while (files.hasNext()) {
      var file = files.next();
      if (file.getLastUpdated() > latestDate) {
        latestDate = file.getLastUpdated();
        latestFile = file;
      }
    }

    // SON SYNC TARİHİ KONTROLÜ — Excel güncellenmemişse tekrar import etme
    var props = PropertiesService.getScriptProperties();
    var lastSyncDate = props.getProperty("LAST_EXCEL_SYNC_DATE");
    var lastSyncFile = props.getProperty("LAST_EXCEL_SYNC_FILE");
    var fileLastUpdated = latestDate.toISOString();

    if (lastSyncDate === fileLastUpdated && lastSyncFile === latestFile.getName()) {
      Logger.log("📋 Excel değişmemiş, sync atlanıyor.");
      return;  // Excel güncellenmemiş, tekrar import etmeye gerek yok
    }

    log(ss, "📥 Excel güncellenmiş, senkronizasyon başlıyor: " + latestFile.getName());

    // Excel'i geçici Google Sheet'e çevir (Drive API v3)
    var tempFile = Drive.Files.create(
      { name: "temp_invoice_import_" + Date.now(), mimeType: "application/vnd.google-apps.spreadsheet" },
      latestFile.getBlob(),
      { fields: "id" }
    );

    var tempSs = SpreadsheetApp.openById(tempFile.id);

    // "FUND I & II & III - Invoices" sekmesini bul
    var sourceSheet = null;
    var sheetNames = tempSs.getSheets().map(function(s) { return s.getName(); });

    for (var i = 0; i < sheetNames.length; i++) {
      if (sheetNames[i].indexOf("FUND") >= 0 && sheetNames[i].indexOf("Invoice") >= 0) {
        sourceSheet = tempSs.getSheetByName(sheetNames[i]);
        break;
      }
    }

    // İlk sheet'i dene eğer bulamadıysak
    if (!sourceSheet) {
      sourceSheet = tempSs.getSheets()[0];
    }

    log(ss, "📊 Sekme: " + sourceSheet.getName());

    // Veriyi oku
    var data = sourceSheet.getDataRange().getValues();

    // Header satırını bul (Entity, Service Provider, Date...)
    var headerRow = -1;
    for (var r = 0; r < Math.min(data.length, 10); r++) {
      for (var c = 0; c < data[r].length; c++) {
        if (data[r][c] && String(data[r][c]).indexOf("Service Provider") >= 0) {
          headerRow = r;
          break;
        }
      }
      if (headerRow >= 0) break;
    }

    if (headerRow < 0) {
      log(ss, "❌ Header satırı bulunamadı.");
      DriveApp.getFileById(tempFile.id).setTrashed(true);
      return;
    }

    // Sütun indekslerini bul
    var headers = data[headerRow];
    var colMap = {};
    for (var c = 0; c < headers.length; c++) {
      var h = String(headers[c]).toLowerCase().trim();
      if (h.indexOf("service provider") >= 0) colMap.vendor = c;
      if (h === "date" || h.indexOf("invoice date") >= 0 || h.indexOf("date") >= 0) colMap.date = c;
      if (h.indexOf("invoice") >= 0 && h.indexOf("#") >= 0) colMap.invoiceNo = c;
      if (h === "total") colMap.total = c;
      if (h === "status") colMap.status = c;
      if (h === "currency") colMap.currency = c;
    }

    // Fatura No sütunu bulamadıysak F sütununu (index 5) dene
    if (colMap.invoiceNo === undefined) colMap.invoiceNo = 5;
    if (colMap.vendor === undefined) colMap.vendor = 1;
    if (colMap.date === undefined) colMap.date = 2;
    if (colMap.total === undefined) colMap.total = 8;
    if (colMap.status === undefined) colMap.status = 9;

    // Bilinen Faturalar sekmesini temizle ve yeniden yaz
    var knownSheet = ss.getSheetByName(CONFIG.SHEET_KNOWN_INVOICES);
    if (!knownSheet) {
      log(ss, "❌ Bilinen Faturalar sekmesi bulunamadı.");
      DriveApp.getFileById(tempFile.id).setTrashed(true);
      return;
    }

    var lastRow = knownSheet.getLastRow();
    if (lastRow > 1) {
      knownSheet.getRange(2, 1, lastRow - 1, 6).clearContent();
    }

    var importCount = 0;
    var seenInvoiceNos = {};
    var importRows = [];

    for (var r = headerRow + 1; r < data.length; r++) {
      var row = data[r];
      var invoiceNo = row[colMap.invoiceNo];
      var vendor = row[colMap.vendor];

      // Boş satırları, header tekrarlarını ve özet satırlarını atla
      if (!invoiceNo && !vendor) continue;
      if (String(vendor).indexOf("Service Provider") >= 0) continue;
      if (String(vendor).indexOf("Entity") >= 0) continue;
      if (String(invoiceNo).indexOf("Total") >= 0) continue;
      if (String(invoiceNo).indexOf("To be Paid") >= 0) continue;

      var invoiceNoStr = normalizeInvoiceNo(invoiceNo);
      if (!invoiceNoStr || invoiceNoStr === "undefined") continue;

      // Duplikasyon kontrolü
      if (seenInvoiceNos[invoiceNoStr]) continue;
      seenInvoiceNos[invoiceNoStr] = true;

      var dateVal = row[colMap.date];
      var dateStr = "";
      if (dateVal instanceof Date) {
        dateStr = Utilities.formatDate(dateVal, Session.getScriptTimeZone(), "dd.MM.yyyy");
      } else {
        dateStr = String(dateVal || "");
      }

      importRows.push([
        invoiceNoStr,
        String(vendor || "").trim(),
        dateStr,
        row[colMap.total] || "",
        String(row[colMap.status] || "").trim(),
        "Excel Import"
      ]);
    }

    // Batch yazma
    if (importRows.length > 0) {
      knownSheet.getRange(2, 1, importRows.length, 6).setValues(importRows);
    }
    importCount = importRows.length;

    // Geçici dosyayı sil
    try { DriveApp.getFileById(tempFile.id).setTrashed(true); } catch(e) {}

    log(ss, "✅ " + importCount + " fatura Drive Excel'inden import edildi.");
    Logger.log("✅ " + importCount + " fatura import edildi.");

    // Sync tarihini kaydet — bir sonraki çalışmada gereksiz import yapma
    props.setProperty("LAST_EXCEL_SYNC_DATE", fileLastUpdated);
    props.setProperty("LAST_EXCEL_SYNC_FILE", latestFile.getName());

  } catch (e) {
    log(ss, "❌ Excel import hatası: " + e.message);
    Logger.log("❌ Hata: " + e.message);
  }
}
// ==================== KURULUM & MENÜ ====================
function setupTriggers() {
  // Mevcut tetikleyicileri temizle
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    ScriptApp.deleteTrigger(triggers[i]);
  }

  // Günlük sabah 8:00
  ScriptApp.newTrigger("dailyScan").timeBased().everyDays(1).atHour(8).create();

  // Haftalık pazartesi 9:00 (30 gün geriye)
  ScriptApp.newTrigger("weeklyScan").timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(9).create();

  const ss = getOrCreateSpreadsheet();
  Logger.log("✅ Kurulum tamamlandı. Sheet: " + ss.getUrl());
  Logger.log("• Günlük tarama: Her gün 08:00");
  Logger.log("• Haftalık derin tarama: Her pazartesi 09:00");
  Logger.log("• Bildirim maili: Her tarama sonrası");
  Logger.log("⚠️ CONFIG bölümünde APPROVAL_EMAIL_TO ve APPROVAL_EMAIL_SIGNATURE güncelle");
  Logger.log("🤖 Gemini AI: " + (isGeminiAvailable() ? "✅ AKTİF" : "❌ API key girilmemiş (opsiyonel)"));
  Logger.log("İlk tarama için weeklyScan fonksiyonunu çalıştır.");
}
function weeklyScan() {
  dailyScan(30);  // 30 gün geriye bak
}
function manualScan() {
  dailyScan();
  try {
    SpreadsheetApp.getUi().alert("Manuel Tarama Tamamlandı ✅\nSonuçları sekmelerde kontrol edin.");
  } catch(e) {
    Logger.log("Manuel Tarama Tamamlandı ✅ Sonuçları sekmelerde kontrol edin.");
  }
}
function onOpen() {
  var menu = SpreadsheetApp.getUi()
    .createMenu("🧾 Fatura Tracker")
    .addItem("🔍 Şimdi Tara", "manualScan")
    .addItem("📧 Onay Maili Oluştur (seçili satırlar)", "createApprovalDraft")
    .addSeparator()
    .addItem("📋 Bilinen Faturaları Import Et", "importKnownInvoices")
    .addItem("📥 Excel'den Senkronize Et", "syncFromDriveExcel")
    .addItem("⚙️ Tetikleyicileri Kur", "setupTriggers")
    .addSeparator()
    .addItem("🤖 Gemini AI Test", "testGemini");
  menu.addToUi();
}
function importKnownInvoices() {
  try {
    SpreadsheetApp.getUi().alert(
      "Bilinen Faturaları Import Et",
      "📋 Bilinen Faturalar sekmesine mevcut Excel'inizdeki fatura numaralarını yapıştırın.\n\n" +
      "Format: Fatura No | Vendor | Tarih | Tutar | Status | Kaynak\n\n" +
      "Bu cross-check özelliğinin çalışması için gereklidir.",
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  } catch(e) {
    Logger.log("📋 Bilinen Faturalar sekmesine mevcut fatura numaralarını yapıştırın.");
  }
}
// ==================== GEMİNİ AI TEST ====================
/**
 * Gemini API bağlantısını test eder
 * Menü → 🤖 Gemini AI Test ile çalıştır
 */
function testGemini() {
  var msg;

  if (!CONFIG.GEMINI_API_KEY || CONFIG.GEMINI_API_KEY.length < 10) {
    msg = "❌ Gemini API Key girilmemiş!\n\n" +
      "1. https://aistudio.google.com/apikey adresine git\n" +
      "2. 'Create API Key' tıkla (ÜCRETSİZ)\n" +
      "3. Key'i kopyala\n" +
      "4. CONFIG.GEMINI_API_KEY alanına yapıştır\n\n" +
      "Not: Gemini olmadan da çalışır, sadece keyword analizi kullanır.";
  } else {
    // Test isteği gönder
    var testResult = callGemini(
      "Bu bir test mesajıdır. Sadece JSON olarak yanıt ver: {\"status\": \"ok\", \"message\": \"Gemini bağlantısı başarılı\"}",
      128
    );

    if (testResult) {
      // Gerçek fatura testi
      var invoiceTest = analyzeWithGemini(
        "INVOICE\nInvoice No: INV-2026-0042\nFrom: Hawksford Corporate Services\nDate: 2026-03-15\nService: Fund Administration Q1 2026\nAmount Due: EUR 12,500.00\nBank: IBAN LU12 3456 7890 1234 5678\nDue Date: 2026-04-15",
        "billing@hawksford.com",
        "Invoice INV-2026-0042 - Fund Administration"
      );

      msg = "✅ Gemini AI Bağlantısı Başarılı!\n\n" +
        "Model: " + CONFIG.GEMINI_MODEL + "\n" +
        "Durum: Aktif ve çalışıyor\n\n";

      if (invoiceTest) {
        msg += "📋 Test Fatura Analizi:\n" +
          "• Fatura mı: " + (invoiceTest.isInvoice ? "Evet ✅" : "Hayır ❌") + "\n" +
          "• Güven: %" + invoiceTest.confidence + "\n" +
          "• Vendor: " + (invoiceTest.vendor || "—") + "\n" +
          "• Tutar: " + (invoiceTest.amount || "—") + " " + (invoiceTest.currency || "") + "\n" +
          "• Fatura No: " + (invoiceTest.invoiceNo || "—") + "\n" +
          "• Özet: " + (invoiceTest.summary || "—") + "\n\n" +
          "🎉 Gemini fatura analizine hazır!";
      } else {
        msg += "⚠️ Bağlantı var ama fatura analizi çalışmadı. Log'ları kontrol edin.";
      }
    } else {
      msg = "❌ Gemini API yanıt vermedi!\n\n" +
        "Olası sebepler:\n" +
        "• API key yanlış olabilir\n" +
        "• Ücretsiz kota dolmuş olabilir (15 istek/dk)\n" +
        "• Ağ sorunu olabilir\n\n" +
        "Execution Log'u kontrol edin (Ctrl+Enter sonrası).";
    }
  }

  try {
    SpreadsheetApp.getUi().alert("🤖 Gemini AI Test", msg, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {
    Logger.log(msg);
  }
}
