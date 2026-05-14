const splitIntoSentences = (text) => {
  if (!text || typeof text !== 'string') return [];
  const BOUNDARY = '\x00SPLIT\x00';

  const isUpperishStart = (str) => /^["'\-\s]*[\p{Lu}]/u.test(str);

  let s = text;

  // Step 1: " " = speaker-change boundary
  s = s.replace(/" "/g, `"${BOUNDARY}"`);

  // Step 2: quoted speech ending with punctuation gets a boundary after the closing quote
  // ONLY if the quote is at the start of the current sentence/clause.
  s = s.replace(/"([^"]*[.!?…]+[\s]*)"([.,]?\s*)/g, (match, inner, after, offset, fullString) => {
    // 1. Get all text before the current quote
    const textBefore = fullString.slice(0, offset);

    // 2. Find where the previous sentence ended
    let lastPunctIdx = -1;
    for (let i = textBefore.length - 1; i >= 0; i--) {
      if (/[.!?…]/.test(textBefore[i])) {
        lastPunctIdx = i;
        break;
      }
    }

    // 3. Check if there are letters/words between the start of the current sentence and the quote
    const textBetween = textBefore.slice(lastPunctIdx + 1);
    const textBetweenClean = textBetween.split(BOUNDARY).join('');
    const hasWordsBefore = /[\p{L}\p{N}]/u.test(textBetweenClean);

    // 4. If there are NO words before, it's safe to evaluate it as a dialogue tag split.
    if (!hasWordsBefore) {
      const rest = fullString.slice(offset + match.length);
      if (rest.length === 0 || isUpperishStart(rest)) {
        return `"${inner}"${after.trim()}${BOUNDARY}`;
      }
    }

    return match; // Otherwise, leave it alone and let `splitSegment` handle outer punctuation
  });

  const segments = s.split(BOUNDARY).map(s => s.trim()).filter(Boolean);

  // Split a segment at sentence-ending punctuation that is OUTSIDE of quotes
  const splitSegment = (seg) => {
    const results = [];
    let current = '';
    let inQuote = false;
    let i = 0;

    // Check if the segment has unbalanced quotes.
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

      // Only remove a trailing quote if the total number of quotes is unbalanced
      const finalQuoteCount = (trimmed.match(/"/g) || []).length;
      if (finalQuoteCount % 2 !== 0 && trimmed.endsWith('"')) {
        return trimmed.slice(0, -1).trim();
      }

      return trimmed;
    })
    .filter(s => s.replace(/["'""''.,!?…\-\s]/g, '').length > 0);
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