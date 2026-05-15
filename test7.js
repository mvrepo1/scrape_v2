const splitIntoSentences = (text) => {
  if (!text || typeof text !== 'string') return [];

  // Nhận diện ký tự mở và đóng ngoặc
  const openQuotes = ['"', '\u201c', '\u300c', '\u300e'];
  const closeQuotes = ['"', '\u201d', '\u300d', '\u300f'];
  const allQuotes = [...openQuotes, ...closeQuotes];

  const isUpperishStart = (str) => /^["\u201c\u201d\u300c\u300e\-\s]*[\p{Lu}]/u.test(str);

  // Hàm tiện ích đếm số lần xuất hiện của một ký tự
  const countChar = (str, char) => {
    let count = 0;
    for (let i = 0; i < str.length; i++) {
      if (str[i] === char) count++;
    }
    return count;
  };

  // Danh sách viết tắt — không cắt câu sau dấu chấm của các từ này
  const abbreviations = new Set([
    'Mr', 'Mrs', 'Ms', 'Miss', 'Dr', 'Prof', 'St', 'Jr', 'Sr',
    'Rev', 'Lt', 'Capt', 'Col', 'Gen', 'Sgt', 'Cpl', 'Pvt', 'Gov',
    'GS', 'PGS', 'TS', 'ThS', 'BS', 'KS', 'LS', 'Tp', 'TP'
  ]);
  const endsWithAbbreviation = (str) => {
    const match = str.match(/(\p{L}+)\s*$/u);
    return match ? abbreviations.has(match[1]) : false;
  };

  // Kiểm tra tính cân bằng của các dấu ngoặc đặc biệt
  const specialPairs = { '\u201c': '\u201d', '\u300c': '\u300d', '\u300e': '\u300f' };
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

    // Kiểm tra tính cân bằng của dấu ngoặc kép thẳng
    const straightQuoteCount = countChar(seg, '"');
    const ignoreStraightQuotes = straightQuoteCount % 2 !== 0;

    // FIX: track số " đã thấy để biết đang trong hay ngoài straight quote
    let seenStraightQuotes = 0;

    while (i < seg.length) {
      const ch = seg[i];

      // XỬ LÝ DẤU NGOẶC
      if (allQuotes.includes(ch)) {
        // Xử lý riêng cho dấu ngoặc thẳng (")
        if (ch === '"') {
          seenStraightQuotes++; // FIX: luôn đếm kể cả khi ignoreStraightQuotes

          if (ignoreStraightQuotes) {
            // FIX: vẫn set startedWithQuote khi " mở (seenSQ lẻ) và current trống
            if (seenStraightQuotes % 2 === 1 && current.trim().replace(/^[\-\s]+/, '') === '') {
              startedWithQuote = true;
            }
          } else {
            if (quoteLevel > 0 && current.includes('"')) {
              quoteLevel--;
            } else {
              if (current.trim().replace(/^[\-\s]+/, '') === '') startedWithQuote = true;
              quoteLevel++;
            }
          }
        }
        // Xử lý ngoặc cong/đặc biệt
        else if (openQuotes.includes(ch)) {
          if (!unbalanced[ch]) {
            if (current.trim().replace(/^[\-\s]+/, '') === '') startedWithQuote = true;
            quoteLevel++;
          }
        } else if (closeQuotes.includes(ch)) {
          if (!unbalanced[ch]) {
            quoteLevel = Math.max(0, quoteLevel - 1);
          }
        }

        current += ch;
        i++;

        // Khi vừa thoát ra khỏi lớp ngoặc ngoài cùng
        // FIX: với straight quote và ignoreStraightQuotes=true,
        // chỉ trigger block cắt khi seenSQ chẵn (vừa "đóng" quote)
        const isStraightQuote = ch === '"';
        const straightQuoteJustClosed = isStraightQuote && ignoreStraightQuotes && seenStraightQuotes % 2 === 0;
        const shouldCheckSplit = quoteLevel === 0 && !unbalanced[ch] && (!isStraightQuote || !ignoreStraightQuotes || straightQuoteJustClosed);

        if (shouldCheckSplit) {
          const rest = seg.slice(i);
          const nextNonSpaceMatch = rest.match(/^\s*(.)/);

          if (nextNonSpaceMatch) {
            const nextChar = nextNonSpaceMatch[1];
            // Fix: Cho phép khớp nhiều dấu ngoặc đóng (VD: !"")
            const endingPunctMatch = current.trimEnd().match(/([.!?…]+)["\u201d\u300d\u300f]+$/);

            if (endingPunctMatch && (!hasOuterWords || startedWithQuote)) {
              const punct = endingPunctMatch[1];
              const isJustEllipsis = /^(\.{2,}|…+)$/.test(punct);

              const nextQuoteIndex = rest.search(/["\u201c\u300c\u300e]/);
              const textUntilNextQuote = nextQuoteIndex !== -1 ? rest.slice(0, nextQuoteIndex) : rest;
              const firstEndPunctIndex = textUntilNextQuote.search(/[.!?…]/);
              const hasEndPunctInRest = firstEndPunctIndex !== -1;
              const textInFirstSentence = hasEndPunctInRest ? textUntilNextQuote.slice(0, firstEndPunctIndex) : textUntilNextQuote;

              // FIX: chỉ coi là dialogue tag nếu đoạn trước dấu câu đủ ngắn (< 50 ký tự)
              const hasCommaInFirstSentence = /,/.test(textInFirstSentence) && textInFirstSentence.trim().length < 50;

              // Kiểm tra xem trong ngoặc có chứa nhiều câu con không
              const textInsideQuote = current.replace(/^["\u201c\u201d\u300c\u300e\-\s]+/, '').replace(/["\u201c\u201d\u300d\u300f\s]+$/, '');
              const hasInternalSentence = /[.!?…]+[\s]+/.test(textInsideQuote);

              // Nếu trong ngoặc có nhiều câu, ưu tiên nối liền với dialogue tag phía sau
              if (!hasInternalSentence) {
                if ((isUpperishStart(rest) && !isJustEllipsis && hasEndPunctInRest && !hasCommaInFirstSentence) || allQuotes.includes(nextChar)) {
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

      // XỬ LÝ DẤU CÂU (CHỈ KHI Ở NGOÀI NGOẶC)
      // FIX: inStraightQuote chỉ true khi còn " phía sau để đóng
      const remainingStraightQuotes = straightQuoteCount - seenStraightQuotes;
      const inStraightQuote = ignoreStraightQuotes && (seenStraightQuotes % 2 === 1) && remainingStraightQuotes > 0;

      if (quoteLevel === 0 && !inStraightQuote && /[.!?…]/.test(ch)) {
        let punct = '';
        while (i < seg.length && /[.!?…]/.test(seg[i])) {
          punct += seg[i];
          i++;
        }
        current += punct;

        const rest = seg.slice(i);
        // FIX: không cắt nếu token trước dấu chấm là viết tắt
        const isAbbrev = punct === '.' && endsWithAbbreviation(current.slice(0, -1));
        if (!isAbbrev && (rest.trim().length === 0 || isUpperishStart(rest))) {
          results.push(current.trim());
          current = '';
          hasOuterWords = false;
          startedWithQuote = false;
        }
        continue;
      }

      // THEO DÕI CHỮ CÁI NGOÀI NGOẶC
      if (quoteLevel === 0 && /[\p{L}\p{N}]/u.test(ch)) {
        hasOuterWords = true;
      }

      current += ch;
      i++;
    }

    if (current.trim()) results.push(current.trim());
    return results;
  };

  return splitSegment(text)
    .map(s => s.trim())
    .filter(s => s.replace(/["""\u300c\u300d\u300e\u300f'.,!?…\-\s]/g, '').length > 0);
};

const verifySentencesPattern = (originalParagraph, sentences) => {
  // Nếu input không có nội dung chữ/số thực sự → [] là đúng
  const hasContent = /[\p{L}\p{N}]/u.test(originalParagraph);
  if (!hasContent) {
    return sentences.length === 0
      ? { pass: true }
      : { pass: false, error: 'Input rỗng nhưng có output.' };
  }

  if (!sentences || sentences.length === 0) return { pass: false, error: 'Empty output' };

  // 1. Kiểm tra tính bảo toàn (Data Integrity)
  const originalClean = originalParagraph.replace(/\s+/g, ' ').trim();
  const outputClean = sentences.join(' ').replace(/\s+/g, ' ').trim();

  if (originalClean !== outputClean) {
    return { pass: false, error: 'Data Mismatch: Nội dung bị thay đổi hoặc mất ký tự.' };
  }

  // 2. Kiểm tra Pattern của từng câu
  const openQuotes = ['"', '\u201c', '\u300c', '\u300e'];
  const closeQuotes = ['"', '\u201d', '\u300d', '\u300f'];

  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i].trim();

    // Kiểm tra câu trống
    if (s.length === 0) return { pass: false, error: `Câu thứ ${i} bị rỗng.` };

    // 3. Kiểm tra tính cân bằng dấu ngoặc trong từng câu
    for (let j = 0; j < openQuotes.length; j++) {
      const openIdx = openQuotes[j];
      const closeIdx = closeQuotes[j];

      const countOpen = (s.match(new RegExp(openIdx, 'g')) || []).length;
      const countClose = (s.match(new RegExp(closeIdx, 'g')) || []).length;

      const totalOpen = (originalParagraph.match(new RegExp(openIdx, 'g')) || []).length;
      const totalClose = (originalParagraph.match(new RegExp(closeIdx, 'g')) || []).length;

      if (totalOpen === totalClose && countOpen !== countClose) {
        return { pass: false, error: `Cắt phạm vào giữa cặp ngoặc ${openIdx}${closeIdx} tại câu: ${s}` };
      }
    }

    // 4. Kiểm tra dấu kết thúc câu (trừ câu cuối cùng có thể không có dấu)
    if (i < sentences.length - 1) {
      const lastChar = s.slice(-1);
      const validEnd = /[.!?…"\u201d\u300d\u300f]/.test(lastChar);
      if (!validEnd) {
        return { pass: false, error: `Câu chưa kết thúc hợp lệ: ${s}` };
      }
    }
  }

  return { pass: true };
};

const tests = [
  { label: 'Test 1', input: 'chúng sinh bị nạn.Sau khi hủy! Trời đất run rẩy? Không ai biết......Đêm khuya.', expected: ['chúng sinh bị nạn.', 'Sau khi hủy!', 'Trời đất run rẩy?', 'Không ai biết......', 'Đêm khuya.'] },
  { label: 'Test 2', input: 'Hắn nhìn nàng', expected: ['Hắn nhìn nàng'] },
  { label: 'Test 3', input: '- Thiên Mệnh, cứu ta! Lý Thiên Mệnh đau đầu.', expected: ['- Thiên Mệnh, cứu ta!', 'Lý Thiên Mệnh đau đầu.'] },
  { label: 'Test 4', input: 'Hắn do dự...... Rồi bước đi.', expected: ['Hắn do dự......', 'Rồi bước đi.'] },
  { label: 'Test 5', input: '"Ngươi là ai?" Hắn hỏi. "Ta không biết!" Nàng đáp.', expected: ['"Ngươi là ai?"', 'Hắn hỏi.', '"Ta không biết!"', 'Nàng đáp.'] },
  {
    label: 'Test 6',
    input: 'Trung niên nam tử vừa nói xong, không có gì ngoài ý muốn, đám người trên quảng trường lại nổi lên trận trận châm chọc tao động"Ba đoạn? Hắc hắc, quả nhiên không ngoài dự đoán của ta, "Thiên tài" và "Thiên tài 2" này một năm rồi vẫn dậm chân tại chỗ a!"! Abc "Câu tiếp theo" câu tiếp theo của câu thiếu. Abc "Câu tiếp theo!" câu tiếp theo của câu thiếu... Abc "Câu tiếp theo?" câu tiếp theo của câu thiếu. Abc "Câu tiếp theo." câu tiếp theo của câu thiếu? Abc "Câu tiếp theo."',
    expected: [
      'Trung niên nam tử vừa nói xong, không có gì ngoài ý muốn, đám người trên quảng trường lại nổi lên trận trận châm chọc tao động"Ba đoạn? Hắc hắc, quả nhiên không ngoài dự đoán của ta, "Thiên tài" và "Thiên tài 2" này một năm rồi vẫn dậm chân tại chỗ a!"!',
      'Abc "Câu tiếp theo" câu tiếp theo của câu thiếu.',
      'Abc "Câu tiếp theo!" câu tiếp theo của câu thiếu...',
      'Abc "Câu tiếp theo?" câu tiếp theo của câu thiếu.',
      'Abc "Câu tiếp theo." câu tiếp theo của câu thiếu?',
      'Abc "Câu tiếp theo."'
    ]
  },
  {
    label: 'Test 7',
    input: '"Đấu lực, ba đoạn" Nhìn năm chữ to lớn có chút chói mắt trên trắc nghiệm ma thạch, thiếu niên mặt không chút thay đổi… "Tiêu Viêm, đấu lực, ba đoạn! Cấp bậc: Cấp thấp!". Bên cạnh trắc nghiệm ma thạch, một vị trung niên nam tử, ngữ khí hờ hững công bố… Trung niên nam tử vừa nói xong, đám người nổi lên trận châm chọc',
    expected: [
      '"Đấu lực, ba đoạn" Nhìn năm chữ to lớn có chút chói mắt trên trắc nghiệm ma thạch, thiếu niên mặt không chút thay đổi…',
      '"Tiêu Viêm, đấu lực, ba đoạn! Cấp bậc: Cấp thấp!".',
      'Bên cạnh trắc nghiệm ma thạch, một vị trung niên nam tử, ngữ khí hờ hững công bố…',
      'Trung niên nam tử vừa nói xong, đám người nổi lên trận châm chọc'
    ]
  },
  {
    label: 'Test 8',
    input: '“Sắc mặt hơi đổi, Tiêu Chiến thu liễm nụ cười, Vân Lam tông tông chủ Vân Vận chính là Gia Mã đế quốc đại nhân vật, hắn nho nhỏ một cái tộc trưởng, nửa điểm đều không thể đắc tội. Bằng thế lực và thực lực của hắn, có việc gì lại cần Tiêu gia hỗ trợ? Cát Diệp nói cùng Nạp Lan chất nữ có quan hệ, chẳng lẽ?',
    expected: [
      '“Sắc mặt hơi đổi, Tiêu Chiến thu liễm nụ cười, Vân Lam tông tông chủ Vân Vận chính là Gia Mã đế quốc đại nhân vật, hắn nho nhỏ một cái tộc trưởng, nửa điểm đều không thể đắc tội.',
      'Bằng thế lực và thực lực của hắn, có việc gì lại cần Tiêu gia hỗ trợ?',
      'Cát Diệp nói cùng Nạp Lan chất nữ có quan hệ, chẳng lẽ?'
    ]
  },
  {
    label: 'Test 9',
    input: '"Sắc mặt hơi đổi, Tiêu Chiến thu liễm nụ cười, Vân Lam tông tông chủ Vân Vận chính là Gia Mã đế quốc đại nhân vật, hắn nho nhỏ một cái tộc trưởng, nửa điểm đều không thể đắc tội. Bằng thế lực và thực lực của hắn, có việc gì lại cần Tiêu gia hỗ trợ? Cát Diệp nói cùng Nạp Lan chất nữ có quan hệ, chẳng lẽ?',
    expected: [
      '"Sắc mặt hơi đổi, Tiêu Chiến thu liễm nụ cười, Vân Lam tông tông chủ Vân Vận chính là Gia Mã đế quốc đại nhân vật, hắn nho nhỏ một cái tộc trưởng, nửa điểm đều không thể đắc tội.',
      'Bằng thế lực và thực lực của hắn, có việc gì lại cần Tiêu gia hỗ trợ?',
      'Cát Diệp nói cùng Nạp Lan chất nữ có quan hệ, chẳng lẽ?'
    ]
  }, {
    label: 'Test 10',
    input: 'Abc "Ngoặc kép." abc. Abc "Ngoặc kép2." Abc edf! Abc "Ngoặc kép3!" Abc edf? Abc "Ngoặc kép4?" Abc edf,',
    expected: [
      'Abc "Ngoặc kép." abc.',
      'Abc "Ngoặc kép2." Abc edf!',
      'Abc "Ngoặc kép3!" Abc edf?',
      'Abc "Ngoặc kép4?" Abc edf,'
    ]
  },
  {
    label: 'Test 30',
    input: '“Tiêu Viêm. Ngươi vậy mà lại chạy thoát khỏi sự truy sát của Hồn Diệt Sinh sao?” Tiếp theo.',
    expected: [
      '“Tiêu Viêm. Ngươi vậy mà lại chạy thoát khỏi sự truy sát của Hồn Diệt Sinh sao?” Tiếp theo.'
    ]
  },
  {
    label: 'Test 31',
    input: '“Tiêu Viêm... Ngươi vậy mà lại chạy thoát khỏi sự truy sát của Hồn Diệt Sinh sao?” Tiếp theo.',
    expected: [
      '“Tiêu Viêm... Ngươi vậy mà lại chạy thoát khỏi sự truy sát của Hồn Diệt Sinh sao?” Tiếp theo.'
    ]
  },
  {
    label: 'Test 32',
    input: '“Tiêu Viêm? Ngươi vậy mà lại chạy thoát khỏi sự truy sát của Hồn Diệt Sinh sao?” Tiếp theo.',
    expected: [
      '“Tiêu Viêm? Ngươi vậy mà lại chạy thoát khỏi sự truy sát của Hồn Diệt Sinh sao?” Tiếp theo.'
    ]
  },
  {
    label: 'Test 33',
    input: '“Tiêu Viêm! Ngươi vậy mà lại chạy thoát khỏi sự truy sát của Hồn Diệt Sinh sao?” Tiếp theo.',
    expected: [
      '“Tiêu Viêm! Ngươi vậy mà lại chạy thoát khỏi sự truy sát của Hồn Diệt Sinh sao?” Tiếp theo.'
    ]
  },
  {
    label: 'Test 34',
    input: '“Tiêu Viêm! ngươi vậy mà lại chạy thoát khỏi sự truy sát của Hồn Diệt Sinh sao? “Tiêu Viêm!”” Tiếp theo.',
    expected: [
      '“Tiêu Viêm! ngươi vậy mà lại chạy thoát khỏi sự truy sát của Hồn Diệt Sinh sao? “Tiêu Viêm!”” Tiếp theo.',
    ]
  },
  {
    label: 'Test 35',
    input: '“Tiêu Viêm!..., Ngươi vậy mà lại chạy thoát khỏi sự truy sát của Hồn Diệt Sinh sao? “Tiêu Viêm!”...” Tiếp theo.',
    expected: [
      '“Tiêu Viêm!..., Ngươi vậy mà lại chạy thoát khỏi sự truy sát của Hồn Diệt Sinh sao? “Tiêu Viêm!”...” Tiếp theo.',
    ]
  },
  {
    label: 'Test 36',
    input: '"Hello." "Bye." He left.',
    expected: ['"Hello."', '"Bye."', 'He left.']
  },
  {
    label: 'Test 37',
    input: 'Mr. Smith went. He arrived.',
    expected: ['Mr. Smith went.', 'He arrived.']
  },
  {
    label: 'Test 38',
    input: 'PGS. Vũ Tuấn công bố "Điều này là hợp lý!" Ông khẳng định đanh thép.',
    expected: ['PGS. Vũ Tuấn công bố "Điều này là hợp lý!" Ông khẳng định đanh thép.']
  },
  {
    label: 'Test 39',
    input: `I shouldn't do this "stupid thing!" Fuck`,
    expected: [`I shouldn't do this "stupid thing!" Fuck`]
  },
  {
    label: 'Test 40',
    input: `"Ai, tuy đấu kĩ là huyền giai, nhưng đấu khí, lại quá yếu, căn bản không phát huy được bao nhiêu uy lưc." Nhìn phá hư lực mà mình tạo thành, Tiêu Viêm bĩu môi, bất đắc dĩ nhẹ giọng lẩm bẩm, theo hiệu quả này, muốn hút được một người, ít nhất cần thất đoạn đấu khí mới có thể làm được."`,
    expected: [
      '"Ai, tuy đấu kĩ là huyền giai, nhưng đấu khí, lại quá yếu, căn bản không phát huy được bao nhiêu uy lưc."',
      'Nhìn phá hư lực mà mình tạo thành, Tiêu Viêm bĩu môi, bất đắc dĩ nhẹ giọng lẩm bẩm, theo hiệu quả này, muốn hút được một người, ít nhất cần thất đoạn đấu khí mới có thể làm được."'
    ]
  },
  {
    label: 'Test 41',
    input: `Học Tiêu Viêm nhún vai mấy cái, Huân Nhi cười khẽ nói: "Nhàm chán quá mà." Ánh mắt chuyển hướng thiếu niên, ẩn ước có chút u oán: "Từ sau lần đó, Tiêu Viêm ca ca cả nửa tháng không đến tìm Huân Nhi rồi, chẳng lẽ là sợ Huân Nhi`,
    expected: [
      'Học Tiêu Viêm nhún vai mấy cái, Huân Nhi cười khẽ nói: "Nhàm chán quá mà." Ánh mắt chuyển hướng thiếu niên, ẩn ước có chút u oán: "Từ sau lần đó, Tiêu Viêm ca ca cả nửa tháng không đến tìm Huân Nhi rồi, chẳng lẽ là sợ Huân Nhi'
    ]
  },
  {
    label: 'Test 42',
    input: `Thất đoạn …Viêm nhi ngươi thực làm được!" Hai mắt nhìn vào tấm hắc thạch, lại nhìn hắc sam thiếu niên, trong mắt Tiêu Chiến thoáng có chút ướt át, hắn trong lòng biết rằng, để đạt được thành tựu này, thiếu niên đã phải nỗ lực, cố gắng thế nào …`,
    expected: [
      'Thất đoạn …Viêm nhi ngươi thực làm được!" Hai mắt nhìn vào tấm hắc thạch, lại nhìn hắc sam thiếu niên, trong mắt Tiêu Chiến thoáng có chút ướt át, hắn trong lòng biết rằng, để đạt được thành tựu này, thiếu niên đã phải nỗ lực, cố gắng thế nào …'
    ]
  },
  {
    label: 'Test 43',
    input: `Ngồi trên Tiêu Chiến, ba vị trưởng lão thần tình đích không thể tin được, này một năm trước mới là tam đoạn đấu khí, hiện tại biến thành thất đoạn? Loại tốc độ này …Làm cho người ta sợ hãi!`,
    expected: [
      'Ngồi trên Tiêu Chiến, ba vị trưởng lão thần tình đích không thể tin được, này một năm trước mới là tam đoạn đấu khí, hiện tại biến thành thất đoạn?',
      'Loại tốc độ này …Làm cho người ta sợ hãi!'
    ]
  },
  {
    label: 'Test 44',
    input: `Một năm thời gian, tăng lên tứ đoạn đấu khí, loại tốc độ tu luyên này …Quả thực khiến cho người nghe hãi nhân`,
    expected: [
      'Một năm thời gian, tăng lên tứ đoạn đấu khí, loại tốc độ tu luyên này …Quả thực khiến cho người nghe hãi nhân'
    ]
  }
];

tests.forEach(t => {
  const result = splitIntoSentences(t.input);
  const pass = JSON.stringify(result) === JSON.stringify(t.expected);
  console.log(`${pass ? '✅' : '❌'} ${t.label}`);
  if (!pass) {
    console.log('  Got:     ', result);
    console.log('  Expected:', t.expected);
  }
});