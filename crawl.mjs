import axios from 'axios';
import * as cheerio from 'cheerio';
import { processChapter, printTestResult } from './chapterProcessor.mjs';

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

    const result = processChapter(data);

    if (!result || result.error) {
      console.log(`[WARN] Nội dung rỗng: ${fullUrl}`);
      return { error: true, reason: 'EMPTY_CONTENT' };
    }

    if (result.sentences.join(' ').length < 100) {
      console.log(`[WARN] Nội dung quá ngắn: ${fullUrl}`);
      return { error: true, reason: 'TOO_SHORT' };
    }

    const title = $('.chapter-title').text().trim() || $('.truyen-title').text().trim();

    // In test result ra console để theo dõi
    console.log(`\n📖 ${title || fullUrl}`);
    printTestResult(result.sentences, result.testResult);

    return {
      title,
      sentences: result.sentences,
      testResult: result.testResult,
    };

  } catch (e) {
    if (e.response) {
      console.error(`[ERR] HTTP ${e.response.status}: ${fullUrl}`);
      return { error: true, reason: `HTTP_${e.response.status}` };
    }
    if (e.code === 'ECONNABORTED' || e.message.includes('timeout')) {
      console.error(`[ERR] TIMEOUT: ${fullUrl}`);
      return { error: true, reason: 'TIMEOUT' };
    }
    console.error(`[ERR] NETWORK ${e.message}: ${fullUrl}`);
    return { error: true, reason: 'NETWORK_ERROR', detail: e.message };
  }
}

// ── Chạy thử ─────────────────────────────────────────────────────────
const url = process.argv[2];
if (!url) {
  console.error('Usage: node crawl.mjs <url>');
  process.exit(1);
}

crawlChapterContent(url);