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