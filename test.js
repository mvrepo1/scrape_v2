const splitIntoSentences = (text) => {
  if (!text || typeof text !== 'string') return [];

  const BOUNDARY = '\x00SPLIT\x00';

  // Bước 1: boundary tại " " 
  let s = text.replace(/" "/g, `"${BOUNDARY}"`);

  // Bước 2: boundary SAU câu thoại có dấu câu kết thúc: "...!" "...?" "...…"
  // Match toàn bộ "..." rồi đặt boundary sau dấu ngoặc đóng + dấu câu tùy chọn
  s = s.replace(/"([^"]*[.!?…][^"]*)"([.,]?\s*)/g, (match, inner, after) => {
    if (/[.!?…]/.test(inner)) {
      return `"${inner}"${after.trim()}${BOUNDARY}`;
    }
    return match;
  });

  const segments = s.split(BOUNDARY).map(s => s.trim()).filter(Boolean);

  const splitByPunctuation = (seg) => {
    if (/^"/.test(seg) && /"[.,]?$/.test(seg)) return [seg];
    return seg
      .split(/([.?!…]+"?)\s+/)
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
    .flatMap(seg => splitByPunctuation(seg))
    .flatMap(seg =>
      seg.split(/([.?!…]+)(?=[\p{Lu}])/u)
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

const tests = [
  { label: 'Test 1', input: 'chúng sinh bị nạn.Sau khi hủy! Trời đất run rẩy? Không ai biết......Đêm khuya.', expected: ['chúng sinh bị nạn.', 'Sau khi hủy!', 'Trời đất run rẩy?', 'Không ai biết......', 'Đêm khuya.'] },
  { label: 'Test 2', input: 'Hắn nhìn nàng', expected: ['Hắn nhìn nàng'] },
  { label: 'Test 3', input: '- Thiên Mệnh, cứu ta! Lý Thiên Mệnh đau đầu.', expected: ['- Thiên Mệnh, cứu ta!', 'Lý Thiên Mệnh đau đầu.'] },
  { label: 'Test 4', input: 'Hắn do dự...... Rồi bước đi.', expected: ['Hắn do dự......', 'Rồi bước đi.'] },
  { label: 'Test 5', input: '"Ngươi là ai?" Hắn hỏi. "Ta không biết!" Nàng đáp.', expected: ['"Ngươi là ai?"', 'Hắn hỏi.', '"Ta không biết!"', 'Nàng đáp.'] },
  {
    label: 'Test 6',
    input: 'Hắc hắc, quả nhiên không ngoài dự đoán của ta, " "Thiên tài" này một năm rồi vẫn dậm chân tại chỗ a!" "Ai, phế vật này thật sự làm mất hết cả mặt mũi gia tộc." "Nếu tộc trưởng không phải phụ thân của hắn. Loại phế vật này sớm đã bị đuổi khỏi gia tộc." "Ai..., thiên tài thiếu niên năm đó, tại sao hôm nay lại lạc phách thành bộ dáng này cơ chứ?"',
    expected: [
      'Hắc hắc, quả nhiên không ngoài dự đoán của ta,',
      '"Thiên tài" này một năm rồi vẫn dậm chân tại chỗ a!"',
      '"Ai, phế vật này thật sự làm mất hết cả mặt mũi gia tộc."',
      '"Nếu tộc trưởng không phải phụ thân của hắn. Loại phế vật này sớm đã bị đuổi khỏi gia tộc."',
      '"Ai..., thiên tài thiếu niên năm đó, tại sao hôm nay lại lạc phách thành bộ dáng này cơ chứ?"'
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