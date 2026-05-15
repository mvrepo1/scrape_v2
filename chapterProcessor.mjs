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

// ── Bước 3: Merge câu thiếu ───────────────────────────────────────────
export const mergeIncompleParagraphs = (paragraphs) => {
  const result = [];
  let buffer = '';

  for (const p of paragraphs) {
    buffer = buffer ? buffer + ' ' + p.trim() : p.trim();
    const { complete } = isParagraphComplete(buffer);
    if (complete) {
      result.push(buffer);
      buffer = '';
    }
  }

  if (buffer) {
    result.push(buffer);
    console.warn(`[WARN] Buffer cuối không hoàn chỉnh: "${buffer.slice(0, 80)}"`);
  }

  return result;
};

export const isParagraphComplete = (paragraph) => {
  const t = paragraph.trim();
  if (!t) return { complete: false, reasons: ['Rỗng'] };

  const reasons = [];

  // 1. Ngoặc cong cân bằng
  const openCount = (t.match(/"/g) || []).length;
  const closeCount = (t.match(/"/g) || []).length;
  if (openCount !== closeCount) {
    reasons.push(`Ngoặc cong lệch: ${openCount} mở / ${closeCount} đóng`);
  }

  // 2. Ngoặc thẳng chẵn
  const straightCount = (t.match(/"/g) || []).length;
  if (straightCount % 2 !== 0) {
    reasons.push(`Ngoặc thẳng lẻ: ${straightCount} cái`);
  }

  // 3. Kết thúc hợp lệ
  if (/,$/.test(t)) {
    reasons.push('Kết thúc bằng dấu phẩy');
  } else if (!/[.!?…"”»]$/.test(t) && !/\.{3}$/.test(t)) {
    reasons.push('Không có dấu kết thúc');
  }

  return {
    complete: reasons.length === 0,
    reasons,
  };
};

// ── Bước 4: Unit test ─────────────────────────────────────────────────
export const unitTestSentences = (sentences) => {
  let passed = 0;
  let failed = 0;
  const failedList = [];

  sentences.forEach((s, i) => {
    const t = s.trim();
    const issues = [];

    const openCount = (t.match(/"/g) || []).length;
    const closeCount = (t.match(/"/g) || []).length;
    if (openCount !== closeCount) {
      issues.push(`Ngoặc cong lệch: ${openCount} mở / ${closeCount} đóng`);
    }

    const straightCount = (t.match(/"/g) || []).length;
    if (straightCount % 2 !== 0) {
      issues.push(`Ngoặc thẳng lẻ: ${straightCount} cái`);
    }

    if (/,$/.test(t)) {
      issues.push('Đuôi là dấu phẩy');
    } else if (!/[.!?…"»]$/.test(t)) {
      issues.push('Không có dấu kết thúc câu');
    }

    const firstChar = t.replace(/^[""]/, '')[0];
    if (firstChar && firstChar === firstChar.toLowerCase() && /\p{L}/u.test(firstChar)) {
      issues.push('Đầu câu là chữ thường');
    }

    if (issues.length === 0) {
      passed++;
    } else {
      failed++;
      failedList.push({ index: i, sentence: t, issues });
    }
  });

  return {
    total: sentences.length,
    passed,
    failed,
    failedList,
    allPassed: failed === 0,
  };
};

const splitIntoSentences = (text) => {
  if (!text || typeof text !== 'string') return [];
  const BOUNDARY = '\x00SPLIT\x00';

  let s = text;

  // Step 1: " " = speaker-change boundary
  s = s.replace(/" "/g, `"${BOUNDARY}"`);

  // Step 2: quoted speech ending with punctuation gets a boundary after the closing quote
  s = s.replace(/"([^"]*[.!?…]+[\s]*)"([.,]?\s*)/g, (match, inner, after) => {
    if (!inner.startsWith(' ')) {
      return `"${inner}"${after.trim()}${BOUNDARY}`;
    }
    return match;
  });

  const segments = s.split(BOUNDARY).map(s => s.trim()).filter(Boolean);

  // Returns true if a string begins with an uppercase letter (optionally preceded by quote/dash/space)
  const isUpperishStart = (str) => /^["'\-\s]*[\p{Lu}]/u.test(str);

  // Split a segment at sentence-ending punctuation that is OUTSIDE of quotes
  const splitSegment = (seg) => {
    const results = [];
    let current = '';
    let inQuote = false;
    let i = 0;

    // FIX: Check if the segment has unbalanced quotes.
    // If quotes are odd, we ignore quote tracking so we don't swallow the rest of the text.
    const quoteCount = (seg.match(/"/g) || []).length;
    const ignoreQuotes = quoteCount % 2 !== 0;

    while (i < seg.length) {
      const ch = seg[i];

      if (ch === '"') {
        if (!ignoreQuotes) {
          inQuote = !inQuote;
        }
        current += ch;
        i++;
        continue;
      }

      if (!inQuote && /[.!?…]/.test(ch)) {
        let punct = '';
        while (i < seg.length && /[.!?…]/.test(seg[i])) {
          punct += seg[i];
          i++;
        }
        const rest = seg.slice(i);
        const spaceMatch = rest.match(/^(\s+)/);

        if (spaceMatch) {
          const after = rest.slice(spaceMatch[1].length);
          if (after.length === 0 || isUpperishStart(after)) {
            results.push((current + punct).trim());
            current = '';
            i += spaceMatch[1].length;
            continue;
          }
        } else if (rest.length > 0 && isUpperishStart(rest)) {
          results.push((current + punct).trim());
          current = '';
          continue;
        }

        current += punct;
        continue;
      }

      current += ch;
      i++;
    }

    if (current.trim()) results.push(current.trim());
    return results;
  };

  return segments
    .flatMap(seg => splitSegment(seg))
    .map(s => {
      const trimmed = s.trim();

      // FIX: Only remove a trailing quote if the total number of quotes is unbalanced (odd)
      const finalQuoteCount = (trimmed.match(/"/g) || []).length;
      if (finalQuoteCount % 2 !== 0 && trimmed.endsWith('"')) {
        return trimmed.slice(0, -1).trim();
      }

      return trimmed;
    })
    .filter(s => s.replace(/["'""''.,!?…\-\s]/g, '').length > 0);
};

// ── Pipeline chính ────────────────────────────────────────────────────
export const processChapter = (html) => {
  const content = extractContent(html);
  if (!content) return { error: true, reason: 'NO_CONTENT' };
  fs.writeFile('content.txt', JSON.stringify(content, null, 2), (err) => {
    if (err) {
      console.error("Lỗi khi lưu file:", err);
    } else {
      console.log("Đã tạo file result thành công!");
    }
  });

  const paragraphs = content.split('\n\n').filter(p => p.trim());
  fs.writeFile('paragraphs.txt', JSON.stringify(paragraphs, null, 2), (err) => {
    if (err) {
      console.error("Lỗi khi lưu file:", err);
    } else {
      console.log("Đã tạo file paragraphs thành công!");
    }
  });
  const sentences = paragraphs.flatMap(p => {
    const ss = splitIntoSentences(p);
    return ss;
  });
  fs.writeFile('sentences.txt', JSON.stringify(sentences, null, 2), (err) => {
    if (err) {
      console.error("Lỗi khi lưu file:", err);
    } else {
      console.log("Đã tạo file result thành công!");
    }
  });
  const testResult = unitTestSentences(sentences);
  fs.writeFile('result.txt', JSON.stringify(testResult, null, 2), (err) => {
    if (err) {
      console.error("Lỗi khi lưu file:", err);
    } else {
      console.log("Đã tạo file result thành công!");
    }
  });

  return { sentences, testResult };
};

// ── In kết quả ───────────────────────────────────────────────────────
export const printTestResult = (sentences, testResult) => {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  TỔNG: ${testResult.total} câu | ✅ PASS: ${testResult.passed} | ❌ FAIL: ${testResult.failed}`);
  console.log(`${'═'.repeat(60)}\n`);

  sentences.forEach((s, i) => {
    const r = testResult.failedList.find(f => f.index === i);
    const status = r ? '❌' : '✅';
    const preview = s.length > 100 ? s.slice(0, 100) + '…' : s;
    console.log(`${status} [${String(i).padStart(2, '0')}] ${preview}`);
    if (r) r.issues.forEach(issue => console.log(`       → ${issue}`));
  });
};
