import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';


// ── Bước 1: Extract content ───────────────────────────────────────────
export function extractContent(html) {
  const $ = cheerio.load(html);
  const contentNode = $('#chapter-c');

  if (!contentNode.length) return null;

  contentNode.find('div, script, style, ins, a, iframe').remove();
  contentNode.find('br').replaceWith('\n');
  contentNode.find('p').each((_, el) => { $(el).after('\n\n'); });

  const rawText = contentNode.text();

  return rawText
    .replace(/"{2,}/g, '"')       // clean " rác từ <em> lồng nhau
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const splitIntoSentences = (text) => {
  if (!text || typeof text !== 'string') return [];

  const openQuotes = ['"', '“', '「', '『'];
  const closeQuotes = ['"', '”', '」', '』'];
  const allQuotes = [...openQuotes, ...closeQuotes];

  // Danh sách từ viết tắt phổ biến (có thể mở rộng thêm)
  const abbreviations = [
    // Tiếng Anh - thông dụng trong truyện
    'Mr', 'Mrs', 'Ms', 'Miss', 'Dr', 'Prof', 'St', 'Jr', 'Sr',
    'Rev', 'Lt', 'Capt', 'Col', 'Gen', 'Sgt', 'Cpl', 'Pvt', 'Gov',
    // Tiếng Việt
    'GS', 'PGS', 'TS', 'ThS', 'BS', 'KS', 'LS', 'Tp', 'TP'
  ];

  const isUpperishStart = (str) => /^["'“「『\-\s]*[\p{Lu}]/u.test(str);
  const isUpperishStartAfterSpace = (str) =>
    /^["'"\u300c\u300e\-]*\s+["'"\u300c\u300e\-\s]*[\p{Lu}]/u.test(str);

  const isAbbreviation = (buffer) => {
    const trimmed = buffer.trim().replace(/[.!?…]+$/, '');
    const words = trimmed.split(/[\s\.]+/);
    const lastWord = words[words.length - 1];
    return abbreviations.includes(lastWord);
  };

  const countChar = (str, char) => {
    let count = 0;
    for (let i = 0; i < str.length; i++) if (str[i] === char) count++;
    return count;
  };

  const specialPairs = { '“': '”', '「': '」', '『': '』' };
  const unbalanced = {};
  for (const [open, close] of Object.entries(specialPairs)) {
    if (countChar(text, open) !== countChar(text, close)) {
      unbalanced[open] = true;
      unbalanced[close] = true;
    }
  }

  const splitSegment = (seg) => {
    const results = [];
    let current = '';
    let quoteLevel = 0;
    let hasOuterWords = false;
    let startedWithQuote = false;
    let i = 0;

    const straightQuoteCount = countChar(seg, '"');
    const ignoreStraightQuotes = straightQuoteCount % 2 !== 0;

    while (i < seg.length) {
      const ch = seg[i];

      if (allQuotes.includes(ch)) {
        // Luôn xác định xem phân đoạn có bắt đầu bằng dấu ngoặc kép không
        if (current.trim().replace(/^[\-\s]+/, '') === '') startedWithQuote = true;

        if (ch === '"') {
          if (!ignoreStraightQuotes) {
            if (quoteLevel > 0 && current.includes('"')) quoteLevel--;
            else quoteLevel++;
          }
        }
        else if (openQuotes.includes(ch)) {
          if (!unbalanced[ch]) quoteLevel++;
        } else if (closeQuotes.includes(ch)) {
          if (!unbalanced[ch]) quoteLevel = Math.max(0, quoteLevel - 1);
        }

        current += ch;
        i++;

        if (quoteLevel === 0 && !unbalanced[ch]) {
          const rest = seg.slice(i);
          const nextNonSpaceMatch = rest.match(/^\s*(.)/);
          if (nextNonSpaceMatch) {
            const nextChar = nextNonSpaceMatch[1];
            const endingPunctMatch = current.trimEnd().match(/([.!?…]+)["”」』]+$/);

            if (endingPunctMatch && (!hasOuterWords || startedWithQuote)) {
              const punct = endingPunctMatch[1];
              const isJustEllipsis = /^(\.{2,}|…+)$/.test(punct);
              const textInsideQuote = current.replace(/^["'“「『\-\s]+/, '').replace(/["'”」』\s]+$/, '');
              const hasInternalSentence = /[.!?…]+[\s]+/.test(textInsideQuote);

              // Kiểm tra viết tắt trước khi tách sau dấu ngoặc
              if (!hasInternalSentence && !isAbbreviation(current)) {
                if ((isUpperishStart(rest) && !isJustEllipsis) || allQuotes.includes(nextChar)) {
                  results.push(current.trim());
                  current = '';
                  hasOuterWords = false;
                  startedWithQuote = false;
                }
              }
            }
          }
        }
        continue;
      }

      if (quoteLevel === 0 && /[.!?…]/.test(ch)) {
        let punct = '';
        while (i < seg.length && /[.!?…]/.test(seg[i])) {
          punct += seg[i];
          i++;
        }

        const tempCurrent = current + punct;

        // CHỈ TÁCH KHI KHÔNG PHẢI TỪ VIẾT TẮT
        if (!isAbbreviation(tempCurrent)) {
          let trailingQuotes = '';
          // Gom cả những dấu đóng ngoặc liền kề vào luôn
          while (i < seg.length && /["'”」』]/.test(seg[i])) {
            trailingQuotes += seg[i];
            i++;
          }

          const fullCurrent = tempCurrent + trailingQuotes;
          const rest = seg.slice(i);

          let canSplit = true;
          // Nếu câu kết thúc chứa dấu ngoặc, kiểm tra điều kiện câu rẽ nhánh
          if (trailingQuotes.length > 0) {
            canSplit = (!hasOuterWords || startedWithQuote);
          }

          const isUnicodeEllipsisOnly = /^\u2026+$/.test(punct);
          const upperCheck = isUnicodeEllipsisOnly ? isUpperishStartAfterSpace(rest) : isUpperishStart(rest);

          if (canSplit && (rest.trim().length === 0 || upperCheck)) {
            results.push(fullCurrent.trim());
            current = '';
            hasOuterWords = false;
            startedWithQuote = false;
            continue;
          }
          current = fullCurrent;
          continue;
        }
        current = tempCurrent;
        continue;
      }

      if (quoteLevel === 0 && /[\p{L}\p{N}]/u.test(ch)) hasOuterWords = true;
      current += ch;
      i++;
    }

    if (current.trim()) results.push(current.trim());
    return results;
  };

  return splitSegment(text)
    .map(s => s.trim())
    .filter(s => s.replace(/["“”「」『』'.,!?…\-\s]/g, '').length > 0);
};

const verifySentencesPattern = (originalParagraph, sentences) => {
  if (!sentences || sentences.length === 0) return { pass: false, error: "Empty output" };

  // 1. Kiểm tra tính bảo toàn (Data Integrity)
  // Loại bỏ khoảng trắng thừa để so sánh nội dung cốt lõi
  const originalClean = originalParagraph.replace(/\s+/g, ' ').trim();
  const outputClean = sentences.join(' ').replace(/\s+/g, ' ').trim();

  if (originalClean !== outputClean) {
    return { pass: false, error: "Data Mismatch: Nội dung bị thay đổi hoặc mất ký tự." };
  }

  // 2. Kiểm tra Pattern của từng câu
  const openQuotes = ['"', '“', '「', '『'];
  const closeQuotes = ['"', '”', '」', '』'];

  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i].trim();

    // Kiểm tra câu trống
    if (s.length === 0) return { pass: false, error: `Câu thứ ${i} bị rỗng.` };

    // 3. Kiểm tra tính cân bằng dấu ngoặc trong từng câu
    // Nếu một câu có ngoặc mở mà không có ngoặc đóng (trong khi bản gốc có cặp), 
    // nghĩa là hàm split đã cắt nhầm ở giữa ngoặc.
    for (let j = 0; j < openQuotes.length; j++) {
      const openIdx = openQuotes[j];
      const closeIdx = closeQuotes[j];

      const countOpen = (s.match(new RegExp(openIdx, 'g')) || []).length;
      const countClose = (s.match(new RegExp(closeIdx, 'g')) || []).length;

      // Chỉ báo lỗi nếu bản gốc cân bằng mà câu sau khi tách lại không cân bằng
      const totalOpen = (originalParagraph.match(new RegExp(openIdx, 'g')) || []).length;
      const totalClose = (originalParagraph.match(new RegExp(closeIdx, 'g')) || []).length;

      if (totalOpen === totalClose && countOpen !== countClose) {
        return { pass: false, error: `Cắt phạm vào giữa cặp ngoặc ${openIdx}${closeIdx} tại câu: ${s}` };
      }
    }

    // 4. Kiểm tra dấu kết thúc câu (trừ câu cuối cùng có thể không có dấu)
    if (i < sentences.length - 1) {
      const lastChar = s.slice(-1);
      const validEnd = /[.!?…"”」』]/.test(lastChar);
      if (!validEnd) {
        return { pass: false, error: `Câu chưa kết thúc hợp lệ: ${s}` };
      }
    }
  }

  return { pass: true };
};

const batchVerify = (paragraphs) => {
  const logs = {
    total: paragraphs.length,
    passed: 0,
    failed: []
  };

  paragraphs.forEach((p, index) => {
    const sentences = splitIntoSentences(p);
    const report = verifySentencesPattern(p, sentences);

    if (report.pass) {
      logs.passed++;
    } else {
      logs.failed.push({
        index,
        original: p,
        error: report.error,
        output: sentences
      });
    }
  });

  return logs;
};

async function crawlChapterContent(fullUrl) {
  try {
    const { data } = await axios.get(fullUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://truyenfull.vision/',
      },
      timeout: 15000,
    });

    const $ = cheerio.load(data);
    const contentNode = $('#chapter-c');

    if (!contentNode.length) {
      console.log(`[WARN] Không tìm thấy #chapter-c: ${fullUrl}`);
      return { error: true, reason: 'NO_SELECTOR' };
    }

    const content = extractContent(data);
    if (!content) return { error: true, reason: 'NO_CONTENT' };

    const paragraphs = content.split('\n\n').filter(p => p.trim());
    fs.writeFile('paragraphs.txt', JSON.stringify(paragraphs, null, 2), (err) => {
      if (err) {
        console.error("Lỗi khi lưu file:", err);
      } else {
        console.log("Đã tạo file paragraphs thành công!");
      }
    });

    fs.readFile('paragraphs.txt', 'utf8', (err, data) => {
      if (err) {
        console.error("Lỗi khi đọc file:", err);
        return;
      }

      try {
        const paragraphsArray = JSON.parse(data);
        const result = batchVerify(paragraphsArray);
        console.log(`Đã check xong ${result.total} dòng. Lỗi: ${result.failed.length}`);
        if (result.failed.length > 0) {
          for (const error of result.failed) {
            console.log("-----lỗi:", error);
          }
        }

      } catch (parseErr) {
        console.error("Lỗi khi parse JSON:", parseErr);
      }
    });
  } catch (e) {
    console.log(e.message);
  }
}

// ── Chạy thử ─────────────────────────────────────────────────────────
const url = process.argv[2];
if (!url) {
  console.error('Usage: node crawl.mjs <url>');
  process.exit(1);
}

crawlChapterContent(url);
