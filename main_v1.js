require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { decode } = require('html-entities');

// --- CONFIG ---
const R2_CONFIG = {
  endpoint: process.env.R2_ENDPOINT,
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  bucket: process.env.R2_BUCKET,
  publicDomain: process.env.R2_PUBLIC_DOMAIN,
};

const API_CONFIG = {
  baseUrl: process.env.API_BASE_URL,
  headers: {
    'accept': '*/*',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
  },
};

const CRAWL_DELAY_MS = 300;
const LIST_DELAY_MS = 400;

const s3Client = new S3Client({
  region: 'auto',
  endpoint: R2_CONFIG.endpoint,
  credentials: {
    accessKeyId: R2_CONFIG.accessKeyId,
    secretAccessKey: R2_CONFIG.secretAccessKey,
  },
});

// ===== CLEAN =====
function cleanTextForTTS(text) {
  return decode(text)
    .normalize('NFC')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    .replace(/\(\d+\)/g, '')
    .replace(/【[^】]*】/g, '').replace(/《[^》]*》/g, '').replace(/「[^」]*」/g, '')
    .replace(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\u3164]/g, '')
    .replace(/^\s*\d+\.\s*/gm, '').replace(/\s\d+\.\s/g, ' ')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/(?:https?:\/\/|www\.)\S+/g, '')
    .replace(/Bạn đang đọc truyện tại[^.\n]*\.?/gi, '')
    .replace(/[Tt]ruy[eệ]n\s*[Ff][Uu][Ll][Ll]/g, '')
    .replace(/truyenfull\S*/gi, '')
    .replace(/[^\p{L}\p{N}\p{M}\s.,!?;:…"'""''–—()\-/*\n]/gu, ' ')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractMaskedGroups(line) {
  const L = `(?:\\p{L}\\p{M}*)`;
  const STAR = `(?:[*]+\\p{M}*)`;
  const SINGLE = `(?:${L}+(?:${STAR}+${L}*)*${STAR}+${L}*|${L}+${STAR}+${L}+(?:${STAR}*${L}*)*)`;
  const PHRASE_RE = new RegExp(`${SINGLE}(?:\\s+${SINGLE})*`, 'gu');
  const results = [];
  let m;
  while ((m = PHRASE_RE.exec(line)) !== null) {
    const phrase = m[0].trim();
    if (phrase.includes('*') && /\p{L}/u.test(phrase))
      results.push({ phrase, index: m.index, end: m.index + m[0].length });
  }
  return results;
}

function getShortContext(line, matchIndex, matchEnd, maxCharsEachSide = 80, minAfterChars = 20) {
  const masked = line.slice(matchIndex, matchEnd);
  let sentenceStart = 0;
  for (let k = matchIndex - 1; k >= 0; k--) {
    if (/[.!?\n\u201c\u201d\u2026]/.test(line[k])) { sentenceStart = k + 1; break; }
  }
  let sentenceEnd = line.length;
  for (let k = matchEnd; k < line.length; k++) {
    if (/[.!?\n\u201c\u201d\u2026]/.test(line[k])) {
      const afterSoFar = line.slice(matchEnd, k).trim();
      if (afterSoFar.length >= minAfterChars) { sentenceEnd = k + 1; break; }
    }
  }
  const before = line.slice(sentenceStart, matchIndex).trim();
  const after = line.slice(matchEnd, sentenceEnd).trim();
  const tb = before.length <= maxCharsEachSide ? before : '...' + before.slice(-maxCharsEachSide);
  const ta = after.length <= maxCharsEachSide ? after : after.slice(0, maxCharsEachSide) + '...';
  const result = [tb, masked, ta].filter(Boolean).join(' ').trim();
  return result.slice(0, 120);
}

// --- UTILS ---

function saveJSON(filepath, data) {
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8');
}

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

function convertToSlug(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function authorToId(authorName) {
  if (!authorName) return 0;
  const slug = convertToSlug(authorName);
  let hash = 0;
  for (let i = 0; i < slug.length; i++) {
    hash = ((hash << 5) - hash) + slug.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function getInfoPath(slug) {
  return path.join(__dirname, `${slug}-info.json`);
}

function getListPath(slug) {
  return path.join(__dirname, `${slug}-list.json`);
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return content ? JSON.parse(content) : null;
  } catch {
    return null;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function readInfo(slug) {
  return readJson(getInfoPath(slug));
}

function saveInfo(slug, data) {
  writeJson(getInfoPath(slug), data);
}

// --- R2 ---

async function uploadToR2(content, key) {
  const command = new PutObjectCommand({
    Bucket: R2_CONFIG.bucket,
    Key: key,
    Body: content,
    ContentType: 'application/json; charset=utf-8',
  });
  await s3Client.send(command);
  return `${R2_CONFIG.publicDomain}/${key}`;
}

// --- SERVER API ---

async function getStoryFromServer(id) {
  try {
    const { data } = await axios.get(`${API_CONFIG.baseUrl}/get?id=${id}`, { headers: API_CONFIG.headers });
    if (data && data.id) {
      if (typeof data.chapters === 'string') data.chapters = JSON.parse(data.chapters);
      return data;
    }
  } catch { }
  return null;
}

async function saveStoryToServer(storyData) {
  try {
    const payload = { ...storyData, chapters: JSON.stringify(storyData.chapters) };
    await axios.post(`${API_CONFIG.baseUrl}/save`, payload, { headers: API_CONFIG.headers });
    console.log(`   [SERVER] Đã lưu thành công: ${storyData.id}`);
  } catch (e) {
    console.error(`   [SERVER ERROR] ${storyData.id}: ${e.message}`);
  }
}

// --- EXTRACT CONTENT ---

/**
 * Parse HTML chapter, giữ nguyên cấu trúc xuống dòng từ <br> và <p>.
 * @returns {string|null}
 */
function extractContent(html) {
  const $ = cheerio.load(html);
  const contentNode = $('#chapter-c');

  if (!contentNode.length) return null;

  contentNode.find('div, script, style, ins, a, iframe').remove();
  contentNode.find('br').replaceWith('\n');
  contentNode.find('p').each((_, el) => { $(el).after('\n\n'); });

  const rawText = contentNode.text();

  return rawText
    .replace(/"{2,}/g, '"')
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// --- SCRAPE ---

/**
 * Lấy metadata truyện từ trang chủ truyện.
 * Lưu thêm: truyen_id, total_page, story_name_raw (dùng cho AJAX list chapter).
 */
async function scrapeInfo(url, slug) {
  try {
    const { data } = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 15000,
    });
    const $ = cheerio.load(data);
    const score = +(parseFloat($('span[itemprop="ratingValue"]').text().trim()) || 0.0).toFixed(1);

    // Lấy truyen_id và total_page từ hidden input
    const truyenId = $('input#truyen-id').val() || '';
    const totalPage = parseInt($('input#total-page').val() || '1', 10);

    // Lấy tên truyện gốc (dùng cho query param tname)
    const storyNameRaw = $('.col-info-desc h3.title').text().trim();

    // Lấy status: "Full" hoặc "Đang ra"
    const statusText = $('.info').find('span.text-success, span.text-primary').first().text().trim();
    const publishStatus = statusText.toLowerCase().includes('full') ? 'full' : 'ongoing';

    const storyData = {
      id: slug,
      name: storyNameRaw,
      author: $('.info a[itemprop="author"]').first().text().trim(),
      author_id: authorToId($('.info a[itemprop="author"]').first().text().trim()),
      description: $('.desc-text').text().trim(),
      origin: url,
      categories: $('.info a[itemprop="genre"]').map((_, el) => $(el).text()).get().join(', '),
      score,
      read_total: score > 9.0 ? 85 : score > 8.0 ? 72 : score > 7.0 ? 70 : score > 6.0 ? 60 : 40,
      publish_status: publishStatus,
      // Metadata dùng nội bộ để sync chapter list
      truyen_id: truyenId,
      total_page: totalPage,
      story_name_raw: storyNameRaw,
      chapters: [],
      chapter_total: 0,
      status: 'pending',
    };

    saveInfo(slug, storyData);
    return storyData;
  } catch (e) {
    console.error(`   [ERROR] scrapeInfo(${slug}): ${e.message}`);
    return null;
  }
}

/**
 * Cào nội dung một chương.
 * @returns {{ title, content, paragraphs }}       nếu thành công
 *          {{ error: true, reason, detail }}       nếu thất bại
 */
async function crawlChapterContent(fullUrl) {
  try {
    const { data } = await axios.get(fullUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://truyenfull.vision/',
      },
      timeout: 15000,
    });

    const content = extractContent(data);

    if (content === null) {
      console.log(`      [WARN] Không tìm thấy #chapter-c: ${fullUrl}`);
      return { error: true, reason: 'NO_SELECTOR', detail: 'Không tìm thấy #chapter-c trong HTML' };
    }

    if (!content) {
      console.log(`      [WARN] Nội dung rỗng: ${fullUrl}`);
      return { error: true, reason: 'EMPTY_CONTENT', detail: 'Nội dung sau khi parse bị rỗng' };
    }

    if (content.length < 100) {
      console.log(`      [WARN] Nội dung quá ngắn (${content.length} ký tự): ${fullUrl}`);
      return { error: true, reason: 'TOO_SHORT', detail: `Chỉ có ${content.length} ký tự (ngưỡng tối thiểu: 100)` };
    }

    const $ = cheerio.load(data);
    const title = $('.chapter-title').text().trim() || $('.truyen-title').text().trim();

    // Split thành paragraphs để upload JSON
    const paragraphs = content.split('\n\n').filter(p => p.trim());

    return { title, content, paragraphs };
  } catch (e) {
    if (e.response) {
      const status = e.response.status;
      console.error(`      [ERR] HTTP ${status}: ${fullUrl}`);
      return { error: true, reason: `HTTP_${status}`, detail: `Server trả về HTTP ${status}` };
    }
    if (e.code === 'ECONNABORTED' || e.message.includes('timeout')) {
      console.error(`      [ERR] TIMEOUT: ${fullUrl}`);
      return { error: true, reason: 'TIMEOUT', detail: `Request timeout sau 15000ms` };
    }
    console.error(`      [ERR] NETWORK ${e.message}: ${fullUrl}`);
    return { error: true, reason: 'NETWORK_ERROR', detail: e.message };
  }
}

// --- CHAPTER LIST (AJAX) ---

/**
 * Lấy danh sách chương từ 1 trang AJAX.
 * @returns {Array<{ slug, url, title }>}
 */
async function fetchChapterPage(tid, tascii, tname, page, totalp) {
  const ajaxUrl = `https://truyenfull.vision/ajax.php?type=list_chapter&tid=${tid}&tascii=${tascii}&tname=${encodeURIComponent(tname)}&page=${page}&totalp=${totalp}`;
  try {
    const { data } = await axios.get(ajaxUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': `https://truyenfull.vision/${tascii}/trang-${page}/`,
        'X-Requested-With': 'XMLHttpRequest',
      },
      timeout: 10000,
    });

    if (!data || !data.chap_list) return [];

    const $ = cheerio.load(data.chap_list);
    const chapters = [];

    $('.list-chapter li a').each((_, el) => {
      const href = $(el).attr('href') || '';
      const title = $(el).text().trim();

      // Lấy slug chương từ href: "https://.../truyen-abc/chuong-123/" → "chuong-123"
      const match = href.match(/\/(chuong-[^/]+)\/?$/);
      if (!match) return;

      const chapterSlug = match[1]; // vd: "chuong-1601", "chuong-1-1"
      chapters.push({ slug: chapterSlug, url: href, title });
    });

    return chapters;
  } catch (e) {
    console.error(`   [AJAX ERR] page ${page}: ${e.message}`);
    return [];
  }
}

/**
 * Đồng bộ danh sách chương qua AJAX.
 * - Primary key: slug
 * - ID gán tuần tự theo thứ tự thực tế từ trang nguồn (1, 2, 3...)
 * - Nếu có chương mới chèn giữa → reassign id từ vị trí đó trở lên
 * - Nếu chương mới thêm cuối → tăng id tiếp
 */
async function syncChapterList(localData) {
  const { id: storyId, truyen_id, total_page, story_name_raw, origin } = localData;

  if (!truyen_id || !total_page) {
    console.error(`   [LIST ERR] Thiếu truyen_id hoặc total_page trong info: ${storyId}`);
    return readJson(getListPath(storyId)) || [];
  }

  const listFilePath = getListPath(storyId);
  const masterList = readJson(listFilePath) || [];

  // Build slug set hiện tại để dedup
  const existingSlugs = new Set(masterList.map(c => c.slug));

  const urlObj = new URL(origin);
  const tascii = urlObj.pathname.replace(/^\/|\/$/g, '').split('/').pop();

  console.log(`   [LIST] Đồng bộ danh sách chương qua AJAX: ${storyId} (${total_page} trang)`);

  // Thu thập toàn bộ slug từ tất cả trang, giữ đúng thứ tự
  const allChaptersOrdered = []; // { slug, url, title } theo thứ tự trang

  for (let page = 1; page <= total_page; page++) {
    const chapters = await fetchChapterPage(truyen_id, tascii, story_name_raw, page, total_page);
    for (const ch of chapters) {
      if (!allChaptersOrdered.some(c => c.slug === ch.slug)) {
        allChaptersOrdered.push(ch);
      }
    }
    await delay(LIST_DELAY_MS);
  }

  console.log(`   [LIST] Tổng slug từ nguồn: ${allChaptersOrdered.length}`);

  if (allChaptersOrdered.length === 0) {
    console.log(`   [LIST] Không lấy được chương nào, giữ nguyên masterList.`);
    return masterList;
  }

  // So sánh với masterList hiện tại để phát hiện chương mới
  let needReassign = false;
  let insertPosition = -1;

  for (let i = 0; i < allChaptersOrdered.length; i++) {
    const slug = allChaptersOrdered[i].slug;
    if (!existingSlugs.has(slug)) {
      // Chương mới — kiểm tra vị trí
      if (i < masterList.length) {
        // Chèn giữa → cần reassign từ đây trở lên
        if (!needReassign) {
          needReassign = true;
          insertPosition = i;
        }
      }
      // Thêm vào masterList với slug, chưa có id
      masterList.splice(i, 0, {
        slug,
        url: allChaptersOrdered[i].url,
        title: allChaptersOrdered[i].title,
        status: 'pending',
      });
      existingSlugs.add(slug);
    }
  }

  // Reassign toàn bộ id theo thứ tự hiện tại (1-based)
  // Nếu có chèn giữa → reassign từ insertPosition trở lên
  // Nếu chỉ thêm cuối → chỉ gán id cho phần tử mới
  if (needReassign || masterList.some(c => c.id === undefined)) {
    console.log(`   [LIST] Reassign ID${needReassign ? ` từ vị trí ${insertPosition + 1}` : ''}`);
    for (let i = 0; i < masterList.length; i++) {
      masterList[i].id = i + 1;
    }
  } else {
    // Chỉ gán id cho chương mới thêm ở cuối
    const maxId = masterList.reduce((max, c) => (c.id && c.id > max ? c.id : max), 0);
    let nextId = maxId + 1;
    for (const c of masterList) {
      if (!c.id) {
        c.id = nextId++;
      }
    }
  }

  const totalNew = masterList.filter(c => !existingSlugs.has(c.slug) || c.status === 'pending').length;
  writeJson(listFilePath, masterList);
  console.log(`   [LIST] Tổng: ${masterList.length} chương.`);

  return masterList;
}

// --- CORE: CÀO CHƯƠNG CÒN THIẾU ---

function collectMaskedWords(id, content) {
  const report = [];
  try {
    console.log(`📖 Extracting chapter ${id}...`);
    const cleaned = cleanTextForTTS(content);
    const lines = cleaned.split('\n').filter(l => l.trim());
    for (const line of lines) {
      for (const { phrase, index, end } of extractMaskedGroups(line)) {
        report.push({
          chapter_id: id,
          masked_word: phrase,
          context: getShortContext(line, index, end),
          resolved: null
        });
      }
    }
  } catch (err) {
    console.error(`❌ Error chapter ${id}: ${err.message}`);
  }
  if (report.length > 0) {
    const all = JSON.parse(fs.readFileSync('./a_output/masked_words.json', 'utf-8'));
    saveJSON('./a_output/masked_words.json', [...all, ...report]);
    console.log(`💾 Saved ${report.length} items → masked_words.json`);
  }
}

/**
 * So sánh masterList với localData bằng SLUG.
 * Cào các chương thiếu hoặc chưa có URL R2.
 */
async function crawlMissingChapters(localData, masterList) {
  const infoPath = getInfoPath(localData.id);
  const listFilePath = getListPath(localData.id);

  // Chapters đã có URL R2 hợp lệ — index bằng slug
  const doneSlugs = new Set(
    localData.chapters
      .filter((c) => c.url && c.url.startsWith(R2_CONFIG.publicDomain) && c.slug)
      .map((c) => c.slug)
  );

  const toCrawl = masterList.filter((c) => !doneSlugs.has(c.slug));

  if (!toCrawl.length) {
    console.log(`   [SKIP] Không có chương nào cần cào: ${localData.id}`);
    return false;
  }

  console.log(`   [CRAWL] ${localData.id}: ${toCrawl.length} chương cần cào.`);

  let successCount = 0;

  for (const item of toCrawl) {
    const masterIdx = masterList.findIndex((m) => m.slug === item.slug);
    const result = await crawlChapterContent(item.url);

    if (result && !result.error) {
      // Upload JSON array of paragraphs lên R2
      const r2Key = `${localData.id}/chuong-${item.id}.txt`;
      const r2Url = await uploadToR2(JSON.stringify(result.paragraphs), r2Key);

      // Upsert vào chapters (so khớp bằng slug)
      const existIdx = localData.chapters.findIndex((c) => c.slug === item.slug);
      const chapterEntry = {
        id: item.id,
        slug: item.slug,
        title: result.title || item.title,
        url: r2Url,
      };

      if (existIdx >= 0) {
        localData.chapters[existIdx] = chapterEntry;
      } else {
        localData.chapters.push(chapterEntry);
      }

      delete masterList[masterIdx].error_reason;
      delete masterList[masterIdx].error_detail;
      masterList[masterIdx].status = 'done';
      successCount++;
      console.log(`      [OK] Chương ${item.id} (${item.slug})`);
    } else {
      masterList[masterIdx].status = 'error';
      masterList[masterIdx].error_reason = result?.reason ?? 'UNKNOWN';
      masterList[masterIdx].error_detail = result?.detail ?? '';
      masterList[masterIdx].error_at = new Date().toISOString();
      console.log(`      [ERR] Chương ${item.id} (${item.slug}) — ${masterList[masterIdx].error_reason}`);
    }

    // Sort theo id, lưu sau mỗi chương
    localData.chapters.sort((a, b) => a.id - b.id);
    localData.chapter_total = localData.chapters.length;
    writeJson(infoPath, localData);
    writeJson(listFilePath, masterList);

    await delay(CRAWL_DELAY_MS);
  }

  return successCount > 0;
}

// --- PULL FROM SERVER ---

/**
 * Pull metadata chương từ server về local.
 * So khớp bằng slug. Nếu server chapters thiếu slug → flag needsSlugUpdate.
 * @returns {{ pulled: number, needsSlugUpdate: boolean, serverData: object|null }}
 */
async function pullFromServer(localData) {
  const serverData = await getStoryFromServer(localData.id);
  if (!serverData) {
    console.log(`   [PULL] Server chưa có truyện này.`);
    return { pulled: 0, needsSlugUpdate: false, serverData: null };
  }

  const serverChapters = serverData.chapters || [];

  // Kiểm tra server có slug không
  const serverHasSlugs = serverChapters.length > 0 && serverChapters.every(c => c.slug);
  const needsSlugUpdate = !serverHasSlugs && serverChapters.length > 0;

  if (needsSlugUpdate) {
    console.log(`   [PULL] Server thiếu slug — sẽ force push toàn bộ chapter list sau khi cào.`);
  }

  // So khớp bằng slug (nếu server có slug), hoặc bằng id (fallback tạm thời)
  const localSlugs = new Set(localData.chapters.map(c => c.slug).filter(Boolean));

  let toImport;
  if (serverHasSlugs) {
    toImport = serverChapters.filter(c =>
      !localSlugs.has(c.slug) &&
      c.url &&
      c.url.startsWith(R2_CONFIG.publicDomain)
    );
  } else {
    // Fallback: so khớp bằng id khi server chưa có slug
    const localIds = new Set(localData.chapters.map(c => Number(c.id)));
    toImport = serverChapters.filter(c =>
      !localIds.has(Number(c.id)) &&
      c.url &&
      c.url.startsWith(R2_CONFIG.publicDomain)
    );
  }

  if (toImport.length === 0) {
    console.log(`   [PULL] Local đã đồng bộ với server (${serverChapters.length} chương).`);
    return { pulled: 0, needsSlugUpdate, serverData };
  }

  for (const c of toImport) {
    localData.chapters.push({
      id: Number(c.id),
      slug: c.slug || null,
      title: c.title,
      url: c.url,
    });
  }

  localData.chapters.sort((a, b) => a.id - b.id);
  localData.chapter_total = localData.chapters.length;
  saveInfo(localData.id, localData);

  console.log(`   [PULL] Bổ sung ${toImport.length} chương từ server về local.`);
  return { pulled: toImport.length, needsSlugUpdate, serverData };
}

// --- SYNC SERVER ---

async function syncWithServer(localData, cachedServerData = null, forceFullSync = false) {
  console.log(`   [SYNC] Đồng bộ server: ${localData.id}`);

  const serverData = cachedServerData ?? await getStoryFromServer(localData.id);
  const serverChapters = serverData?.chapters || [];
  const serverHasSlugs = serverChapters.length > 0 && serverChapters.every(c => c.slug);

  // Nếu server thiếu slug hoặc forceFullSync → gửi toàn bộ
  let newChapters;
  if (forceFullSync || !serverHasSlugs) {
    console.log(`   [SYNC] Force full sync — đẩy toàn bộ ${localData.chapters.length} chương.`);
    newChapters = localData.chapters;
  } else {
    const serverSlugs = new Set(serverChapters.map(c => c.slug));
    newChapters = localData.chapters.filter(c => c.slug && !serverSlugs.has(c.slug));
  }

  if (!newChapters.length && serverData && !forceFullSync) {
    console.log(`   [SYNC] Server đã đầy đủ, bỏ qua.`);
    return;
  }

  const mergedChapters = forceFullSync
    ? [...localData.chapters]
    : [...serverChapters, ...newChapters].sort((a, b) => a.id - b.id);

  let readTotal = serverData?.read_total ?? localData.read_total ?? 0;
  if (!serverData?.read_total) {
    const score = Math.max(localData.score ?? 7.0, 7.0);
    const len = mergedChapters.length;
    const bonus = 20 * (1 + score / 20) * (Math.min(len, 1000) / 1000);
    if (len > 100) readTotal += Math.round(bonus);
  }

  const dataToSave = {
    ...localData,
    name: serverData?.name ?? localData.name,
    original_name: serverData?.original_name ?? localData.original_name ?? '',
    author: serverData?.author ?? localData.author,
    author_id: serverData?.author_id ?? localData.author_id,
    img: serverData?.img ?? localData.img ?? '',
    cover_img: serverData?.cover_img ?? localData.cover_img ?? '',
    description: serverData?.description ?? localData.description ?? '',
    categories: serverData?.categories ?? localData.categories ?? [],
    score: serverData?.score ?? localData.score,
    read_total: readTotal,
    publish_status: localData.publish_status ?? serverData?.publish_status ?? 'ongoing',
    // Lưu slug trong mỗi chapter lên server
    chapters: mergedChapters.map(({ id, slug, title }) => ({ id, slug: slug || null, title })),
    chapter_total: mergedChapters.length,
    recommend: serverData?.recommend ?? 0,
    yt: serverData?.yt ?? '',
    status: 'done',
  };

  await saveStoryToServer(dataToSave);
}

// --- MAIN FLOWS ---

async function reloadLocal() {
  console.log('\n========== RELOAD LOCAL ==========');
  const files = fs.readdirSync(__dirname).filter((f) => f.endsWith('-info.json'));

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    console.log(`\n--- [${i + 1}/${files.length}] ${file} ---`);

    const localData = readJson(path.join(__dirname, file));
    if (!localData?.id || !localData?.origin) {
      console.log('   [SKIP] File info không hợp lệ.');
      continue;
    }

    const { needsSlugUpdate, serverData } = await pullFromServer(localData);
    const masterList = await syncChapterList(localData);
    const hasChanges = await crawlMissingChapters(localData, masterList);
    await syncWithServer(localData, hasChanges ? null : serverData, needsSlugUpdate);
  }

  console.log('\n========== RELOAD LOCAL HOÀN TẤT ==========\n');
}

async function crawlCategory(categoryUrl, fromPage = 1, toPage = 1) {
  console.log(`\n========== CRAWL CATEGORY: ${categoryUrl} (trang ${fromPage}-${toPage}) ==========`);

  for (let p = fromPage; p <= toPage; p++) {
    console.log(`\n--- Trang ${p} ---`);
    let links = [];

    try {
      const { data } = await axios.get(`${categoryUrl}trang-${p}/`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 10000,
      });
      const $ = cheerio.load(data);
      links = [...new Set(
        $('a[itemprop="url"]')
          .map((_, el) => $(el).attr('href'))
          .get()
          .filter((h) => h && !h.includes('/the-loai/'))
      )];
    } catch (e) {
      console.error(`   [ERR] Không tải được trang ${p}: ${e.message}`);
      continue;
    }

    for (const link of links) {
      try {
        await crawlSingleStory(link);
      } catch (e) {
        console.error(`   [ERR] Bỏ qua ${link}: ${e.message}`);
      }
    }
  }

  console.log('\n========== CRAWL CATEGORY HOÀN TẤT ==========\n');
}

async function crawlSingleStory(storyUrl) {
  const urlObj = new URL(storyUrl);
  const slug = urlObj.pathname.replace(/^\/|\/$/g, '').split('/').pop();

  console.log(`\n>>> ${slug}`);

  let localData = readInfo(slug);
  if (!localData) {
    console.log(`   [NEW] Khởi tạo info mới.`);
    localData = await scrapeInfo(storyUrl, slug);
    if (!localData) return;
  }

  const { needsSlugUpdate, serverData } = await pullFromServer(localData);
  const masterList = await syncChapterList(localData);
  const hasChanges = await crawlMissingChapters(localData, masterList);

  if (hasChanges || needsSlugUpdate) {
    await syncWithServer(localData, null, needsSlugUpdate);
  } else {
    console.log(`   [SKIP] Không có chương mới, bỏ qua sync server.`);
  }
}

// --- AUDIT SYNC ---

async function auditSync() {
  console.log('\n========== AUDIT SYNC ==========');

  const files = fs.readdirSync(__dirname).filter((f) => f.endsWith('-info.json'));

  const ERROR_LABELS = {
    NO_SELECTOR: 'Không tìm thấy #chapter-c (trang lỗi / đổi cấu trúc HTML)',
    EMPTY_CONTENT: 'Nội dung rỗng sau khi parse',
    TOO_SHORT: 'Nội dung quá ngắn (< 100 ký tự)',
    TIMEOUT: 'Request bị timeout (15s)',
    NETWORK_ERROR: 'Lỗi mạng / DNS',
    HTTP_403: 'HTTP 403 — bị chặn / cần cookie',
    HTTP_404: 'HTTP 404 — chương không tồn tại',
    HTTP_500: 'HTTP 500 — lỗi server nguồn',
    UNKNOWN: 'Lỗi không xác định',
  };

  const report = {
    generatedAt: new Date().toISOString(),
    totalStories: files.length,
    okStories: 0,
    issueStories: 0,
    stories: [],
  };

  const textLines = [
    '========== AUDIT SYNC REPORT ==========',
    `Thời gian: ${report.generatedAt}`,
    `Tổng truyện: ${files.length}`,
    '',
  ];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const storyId = file.replace('-info.json', '');
    console.log(`\n[${i + 1}/${files.length}] ${storyId}`);

    const localData = readJson(path.join(__dirname, file));
    if (!localData?.id || !localData?.origin) {
      const entry = { id: storyId, valid: false, problems: [{ code: 'X', label: 'File info không hợp lệ' }] };
      report.stories.push(entry);
      report.issueStories++;
      textLines.push(`[INVALID] ${storyId} — file info không hợp lệ`);
      continue;
    }

    const masterList = readJson(getListPath(storyId)) || [];
    const serverData = await getStoryFromServer(storyId);

    // Build slug sets
    const listSlugs = new Set(masterList.map(c => c.slug).filter(Boolean));
    const localDoneSlugs = new Set(
      localData.chapters
        .filter(c => c.url && c.url.startsWith(R2_CONFIG.publicDomain) && c.slug)
        .map(c => c.slug)
    );
    const localSlugs = new Set(localData.chapters.map(c => c.slug).filter(Boolean));
    const serverSlugs = new Set((serverData?.chapters || []).map(c => c.slug).filter(Boolean));
    const serverIds = new Set((serverData?.chapters || []).map(c => Number(c.id)));
    const localIds = new Set(localData.chapters.map(c => Number(c.id)));

    const problems = [];

    // [A] List có slug nhưng local thiếu URL R2
    const missingR2 = masterList.filter(c => c.slug && !localDoneSlugs.has(c.slug));
    if (missingR2.length > 0) {
      const byReason = {};
      for (const c of missingR2) {
        const reason = c.error_reason || (c.status === 'error' ? 'UNKNOWN' : 'NOT_CRAWLED');
        if (!byReason[reason]) byReason[reason] = [];
        byReason[reason].push({ id: c.id, slug: c.slug, url: c.url, detail: c.error_detail || '', at: c.error_at || '' });
      }
      problems.push({ code: 'A', label: 'Local thiếu URL R2 (chưa cào hoặc cào lỗi)', total: missingR2.length, byReason });
    }

    // [B] Local có slug không tồn tại trong list
    const localOrphan = localData.chapters.filter(c => c.slug && !listSlugs.has(c.slug));
    if (localOrphan.length > 0) {
      problems.push({ code: 'B', label: 'Local có chapter slug không tồn tại trong list.json', total: localOrphan.length, items: localOrphan.map(c => ({ id: c.id, slug: c.slug })) });
    }

    // [C] Local có chương mà server không có (so slug nếu server có, fallback id)
    const serverHasSlugs = (serverData?.chapters || []).length > 0 && (serverData?.chapters || []).every(c => c.slug);
    const notOnServer = serverHasSlugs
      ? localData.chapters.filter(c => c.slug && !serverSlugs.has(c.slug))
      : localData.chapters.filter(c => !serverIds.has(Number(c.id)));
    if (notOnServer.length > 0) {
      problems.push({ code: 'C', label: 'Local có chương chưa đồng bộ lên server', total: notOnServer.length, items: notOnServer.slice(0, 20).map(c => ({ id: c.id, slug: c.slug })) });
    }

    // [D] Server có chương mà local không có
    if (serverData) {
      const notInLocal = serverHasSlugs
        ? (serverData.chapters || []).filter(c => c.slug && !localSlugs.has(c.slug))
        : (serverData.chapters || []).filter(c => !localIds.has(Number(c.id)));
      if (notInLocal.length > 0) {
        problems.push({ code: 'D', label: 'Server có chương nhưng local không có', total: notInLocal.length, items: notInLocal.slice(0, 20).map(c => ({ id: c.id, slug: c.slug })) });
      }
      // [D2] Server thiếu slug
      if (!serverHasSlugs && (serverData.chapters || []).length > 0) {
        problems.push({ code: 'D2', label: 'Server thiếu slug trong chapter list — cần force sync', total: null, items: [] });
      }
    } else {
      problems.push({ code: 'D', label: 'Không lấy được dữ liệu từ server (chưa tồn tại hoặc lỗi API)', total: null, items: [] });
    }

    // [E] List có chương status=error
    const errorChapters = masterList.filter(c => c.status === 'error');
    if (errorChapters.length > 0) {
      const byReason = {};
      for (const c of errorChapters) {
        const reason = c.error_reason || 'UNKNOWN';
        if (!byReason[reason]) byReason[reason] = [];
        byReason[reason].push({ id: c.id, slug: c.slug, url: c.url, detail: c.error_detail || '', at: c.error_at || '' });
      }
      problems.push({ code: 'E', label: 'List.json có chương bị lỗi (status=error)', total: errorChapters.length, byReason });
    }

    // [F] chapter_total không khớp
    if (localData.chapter_total !== localData.chapters.length) {
      problems.push({ code: 'F', label: `chapter_total (${localData.chapter_total}) ≠ chapters.length (${localData.chapters.length})`, total: null, items: [] });
    }

    // [G] Local thiếu truyen_id hoặc total_page
    if (!localData.truyen_id || !localData.total_page) {
      problems.push({ code: 'G', label: 'Thiếu truyen_id hoặc total_page — cần scrapeInfo lại', total: null, items: [] });
    }

    const storyEntry = {
      id: storyId,
      valid: true,
      listCount: masterList.length,
      localCount: localData.chapters.length,
      serverCount: serverData?.chapters?.length ?? null,
      serverHasSlugs,
      problems,
    };
    report.stories.push(storyEntry);

    const counts = `list:${masterList.length} | local:${localData.chapters.length} | server:${serverData?.chapters?.length ?? 'N/A'}`;
    if (problems.length === 0) {
      report.okStories++;
      console.log(`   ✅ OK — ${counts}`);
      textLines.push(`[OK] ${storyId} — ${counts}`);
    } else {
      report.issueStories++;
      console.log(`   ⚠️  VẤN ĐỀ — ${counts}`);
      textLines.push(``, `[ISSUE] ${storyId} — ${counts}`);

      for (const p of problems) {
        const totalStr = p.total !== null ? ` (${p.total} chương)` : '';
        console.log(`      [${p.code}] ${p.label}${totalStr}`);
        textLines.push(`  [${p.code}] ${p.label}${totalStr}`);

        if (p.byReason) {
          for (const [reason, chapters] of Object.entries(p.byReason)) {
            const label = ERROR_LABELS[reason] || reason;
            console.log(`           → ${reason} (${chapters.length}x): ${label}`);
            textLines.push(`       → ${reason} (${chapters.length}x): ${label}`);
            for (const c of chapters) {
              const line = `           Chương ${c.id} (${c.slug}): ${c.url}${c.detail ? ' — ' + c.detail : ''}${c.at ? ' [' + c.at + ']' : ''}`;
              console.log(line);
              textLines.push(line);
            }
          }
        }

        if (p.items && p.items.length > 0) {
          const sample = p.items.slice(0, 10);
          for (const c of sample) {
            const line = `           ID ${c.id} slug:${c.slug ?? 'N/A'}${c.url ? ' ' + c.url : ''}`;
            console.log(line);
            textLines.push(line);
          }
          if (p.items.length > 10) {
            textLines.push(`           ... và ${p.items.length - 10} chương nữa (xem JSON để biết đầy đủ)`);
          }
        }
      }
    }
  }

  report.okStories = report.stories.filter(s => s.valid && s.problems?.length === 0).length;
  report.issueStories = report.stories.filter(s => !s.valid || s.problems?.length > 0).length;

  const summary = [
    '',
    '========== TỔNG KẾT ==========',
    `Tổng truyện kiểm tra : ${report.totalStories}`,
    `✅ Đồng bộ hoàn toàn : ${report.okStories}`,
    `⚠️  Có vấn đề        : ${report.issueStories}`,
    '',
    'Truyện cần xử lý:',
    ...report.stories
      .filter(s => !s.valid || s.problems?.length > 0)
      .map(s => {
        const codes = (s.problems || []).map(p => p.code).join(', ');
        return `  - ${s.id}  [${codes}]`;
      }),
    '================================',
  ];

  console.log(summary.join('\n'));
  textLines.push(...summary);

  const now = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
  const jsonPath = path.join(__dirname, `audit-report-${now}.json`);
  const txtPath = path.join(__dirname, `audit-report-${now}.txt`);
  writeJson(jsonPath, report);
  fs.writeFileSync(txtPath, textLines.join('\n'), 'utf-8');

  console.log(`\nĐã lưu:`);
  console.log(`  JSON: ${jsonPath}`);
  console.log(`  TXT : ${txtPath}`);

  return report;
}

// --- CRAWL FROM FILE ---

const SOURCE_DOMAIN = 'https://truyenfull.vision';

function normalizeToUrl(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed.endsWith('/') ? trimmed : trimmed + '/';
  }
  const slug = convertToSlug(trimmed);
  if (!slug) return null;
  return `${SOURCE_DOMAIN}/${slug}/`;
}

async function crawlFromFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`[crawlFromFile] File không tồn tại: ${filePath}`);
    return;
  }

  const lines = fs.readFileSync(filePath, 'utf-8')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);

  const urls = [...new Set(lines.map(normalizeToUrl).filter(Boolean))];

  console.log(`\n========== CRAWL FROM FILE: ${filePath} ==========`);
  console.log(`Tổng: ${lines.length} dòng → ${urls.length} URL hợp lệ (sau khi lọc trùng)\n`);

  lines.forEach((original, i) => {
    const url = normalizeToUrl(original);
    console.log(`  [${i + 1}] ${original.padEnd(45)} → ${url ?? 'INVALID'}`);
  });
  console.log('');

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    console.log(`\n[${i + 1}/${urls.length}] ${url}`);
    try {
      await crawlSingleStory(url);
    } catch (e) {
      console.error(`   [ERR] Bỏ qua ${url}: ${e.message}`);
    }
  }

  console.log(`\n========== CRAWL FROM FILE HOÀN TẤT ==========\n`);
}

// --- ENTRY POINT ---
(async () => {
  //await reloadLocal();
  await crawlFromFile(path.join(__dirname, 'aa_list.txt'));
  //await crawlCategory('https://truyenfull.vision/the-loai/trong-sinh/', 1, 3);
  //await crawlCategory('https://truyenfull.vision/danh-sach/truyen-hot/', 101, 150);
  //await auditSync();
})();