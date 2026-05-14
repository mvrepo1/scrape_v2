import * as cheerio from 'cheerio';

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

// ── Bước 2: Split sentences ───────────────────────────────────────────
export const splitIntoSentences = (text) => {
  if (!text || typeof text !== 'string') return [];

  const BOUNDARY = '\x00SPLIT\x00';
  const hasBoundary = /" "/.test(text);

  const s = hasBoundary
    ? text.replace(/" "/g, `"${BOUNDARY}"`)
    : text;

  const segments = hasBoundary ? s.split(BOUNDARY) : [s];

  const splitByPunctuation = (seg, protectQuote) => {
    if (protectQuote && /^"/.test(seg.trim()) && /"$/.test(seg.trim())) {
      return [seg];
    }
    const pattern = protectQuote
      ? /([.?!…]+)\s+(?!")/
      : /([.?!…]+"?)\s+/;
    return seg
      .split(pattern)
      .reduce((acc, p, i) => {
        if (i % 2 === 1) {
          const prev = acc.pop() || '';
          acc.push(prev + p);
        } else {
          if (p.trim()) acc.push(p);
        }
        return acc;
      }, []);
  };

  return segments
    .flatMap(seg => splitByPunctuation(seg, hasBoundary))
    .flatMap(seg =>
      seg
        .split(/([.?!…]+)(?=[\p{Lu}])/u)
        .reduce((acc, p, i) => {
          if (i % 2 === 1) {
            const prev = acc.pop() || '';
            acc.push(prev + p);
          } else {
            if (p.trim()) acc.push(p);
          }
          return acc;
        }, [])
    )
    .map(s => {
      const trimmed = s.trim();
      if (!trimmed.startsWith('"') && trimmed.endsWith('"')) {
        return trimmed.slice(0, -1).trim();
      }
      return trimmed;
    })
    .filter(s => s.replace(/["'""''.,!?…\-\s]/g, '').length > 0);
};

// ── Kiểm tra 1 câu có hoàn chỉnh không ──────────────────────────────
const isSentenceComplete = (s) => {
  const t = s.trim();
  if (!t) return false;

  const openCount  = (t.match(/"/g) || []).length;
  const closeCount = (t.match(/"/g) || []).length;
  if (openCount !== closeCount) return false;

  const straightCount = (t.match(/"/g) || []).length;
  if (straightCount % 2 !== 0) return false;

  if (/,$/.test(t)) return false;
  if (!/[.!?…"»]$/.test(t)) return false;

  const firstChar = t.replace(/^[""]/, '')[0];
  if (firstChar && firstChar === firstChar.toLowerCase() && /\p{L}/u.test(firstChar)) {
    return false;
  }

  return true;
};

// ── Bước 3: Merge câu thiếu ───────────────────────────────────────────
export const mergeBrokenSentences = (sentences) => {
  const result = [];
  let buffer = '';

  for (let i = 0; i < sentences.length; i++) {
    const current = sentences[i].trim();
    if (!current) continue;

    buffer = buffer ? buffer + ' ' + current : current;

    if (isSentenceComplete(buffer)) {
      result.push(buffer);
      buffer = '';
    }
  }

  if (buffer) {
    result.push(buffer);
    console.warn(`[WARN] Buffer cuối không hoàn chỉnh: "${buffer.slice(0, 80)}..."`);
  }

  return result;
};

// ── Bước 4: Unit test ─────────────────────────────────────────────────
export const unitTestSentences = (sentences) => {
  let passed = 0;
  let failed = 0;
  const failedList = [];

  sentences.forEach((s, i) => {
    const t = s.trim();
    const issues = [];

    const openCount  = (t.match(/"/g) || []).length;
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

// ── Pipeline chính ────────────────────────────────────────────────────
export const processChapter = (html) => {
  const content = extractContent(html);
  if (!content) return { error: true, reason: 'NO_CONTENT' };

  const paragraphs = content.split('\n\n').filter(p => p.trim());
  const rawSentences = paragraphs.flatMap(p => splitIntoSentences(p));
  const sentences = mergeBrokenSentences(rawSentences);
  const testResult = unitTestSentences(sentences);

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
