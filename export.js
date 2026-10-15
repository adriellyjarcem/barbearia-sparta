/* =====================================================================
   export.js — geração de arquivos Excel (.xlsx) e PDF
   Sem bibliotecas externas: o .xlsx é montado como ZIP na mão.
   ===================================================================== */

// ---------- ZIP (sem compressão) ----------
const CRC_TABELA = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABELA[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

function zipCriar(arquivos) {
  const enc = new TextEncoder(), partes = [], central = [];
  let offset = 0, total = 0;
  arquivos.forEach((f) => {
    const nome = enc.encode(f.nome), dados = f.dados, crc = crc32(dados), tam = dados.length;
    const lh = new Uint8Array(30 + nome.length), dv = new DataView(lh.buffer);
    dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0x0800, true);
    dv.setUint32(14, crc, true); dv.setUint32(18, tam, true); dv.setUint32(22, tam, true);
    dv.setUint16(26, nome.length, true);
    lh.set(nome, 30);
    partes.push(lh, dados);

    const ch = new Uint8Array(46 + nome.length), cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, tam, true); cv.setUint32(24, tam, true);
    cv.setUint16(28, nome.length, true); cv.setUint32(42, offset, true);
    ch.set(nome, 46);
    central.push(ch);
    offset += lh.length + tam; total += lh.length + tam;
  });
  const tamCentral = central.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22), ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, arquivos.length, true); ev.setUint16(10, arquivos.length, true);
  ev.setUint32(12, tamCentral, true); ev.setUint32(16, total, true);
  return new Blob([...partes, ...central, eocd], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// ---------- Células ----------
// T = texto | B = texto em negrito | N = número | M = dinheiro | P = porcentagem
const T = (v) => ({ t: 's', v: v ?? '', s: 0 });
const B = (v) => ({ t: 's', v: v ?? '', s: 1 });
const N = (v) => ({ t: 'n', v: Number(v) || 0, s: 0 });
const M = (v) => ({ t: 'n', v: Number(v) || 0, s: 2 });
const P = (v) => ({ t: 'n', v: (Number(v) || 0) / 100, s: 3 });
const BM = (v) => ({ t: 'n', v: Number(v) || 0, s: 4 });

const xmlEsc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
function colLetra(n) { let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - r - 1) / 26; } return s; }

function planilhaXML(linhas) {
  const rows = linhas.map((linha, i) => {
    const cels = linha.map((c, j) => {
      const cel = c == null ? T('') : typeof c === 'object' ? c : typeof c === 'number' ? N(c) : T(c);
      const ref = `${colLetra(j + 1)}${i + 1}`;
      return cel.t === 'n'
        ? `<c r="${ref}" s="${cel.s}"><v>${cel.v}</v></c>`
        : `<c r="${ref}" s="${cel.s}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(cel.v)}</t></is></c>`;
    }).join('');
    return `<row r="${i + 1}">${cels}</row>`;
  }).join('');
  const nCols = Math.max(1, ...linhas.map((l) => l.length));
  const cols = `<cols><col min="1" max="1" width="26" customWidth="1"/><col min="2" max="${nCols}" width="16" customWidth="1"/></cols>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${rows}</sheetData></worksheet>`;
}

/**
 * Gera e baixa um arquivo .xlsx.
 * @param {string} nomeArquivo  ex.: "comissoes.xlsx"
 * @param {Array<{nome:string, linhas:Array<Array>}>} abas
 */
function xlsxBaixar(nomeArquivo, abas) {
  const enc = new TextEncoder(), U = (s) => enc.encode(s);
  const n = abas.length;
  const arquivos = [
    { nome: '[Content_Types].xml', dados: U(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${abas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`) },
    { nome: '_rels/.rels', dados: U(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
    { nome: 'xl/workbook.xml', dados: U(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${abas.map((a, i) => `<sheet name="${xmlEsc(a.nome).slice(0, 31)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`) },
    { nome: 'xl/_rels/workbook.xml.rels', dados: U(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${abas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`) },
    { nome: 'xl/styles.xml', dados: U(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="&quot;R$&quot;\\ #,##0.00"/><numFmt numFmtId="165" formatCode="0.0%"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf xfId="0" numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf xfId="0" numFmtId="0" fontId="1" fillId="0" borderId="0" applyFont="1"/><xf xfId="0" numFmtId="164" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/><xf xfId="0" numFmtId="165" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/><xf xfId="0" numFmtId="164" fontId="1" fillId="0" borderId="0" applyNumberFormat="1" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`) },
    ...abas.map((a, i) => ({ nome: `xl/worksheets/sheet${i + 1}.xml`, dados: U(planilhaXML(a.linhas)) })),
  ];
  baixarBlob(zipCriar(arquivos), nomeArquivo);
}

function baixarBlob(blob, nome) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- PDF (janela de impressão) ----------
/** Abre o relatório numa janela pronta para imprimir ou salvar em PDF. */
function pdfImprimir(titulo, corpoHTML) {
  const w = window.open('', '_blank', 'width=980,height=760');
  if (!w) return { erro: true };
  w.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>${xmlEsc(titulo)}</title><style>
    @page { size: A4 portrait; margin: 14mm; }
    * { box-sizing: border-box; }
    body { font-family: "Inter", -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #101215; margin: 0; font-size: 12px; }
    .cab { border-bottom: 3px solid #101215; padding-bottom: 10px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; gap: 14px; }
    .cab .marca { width: 58px; flex-shrink: 0; color: #101215; }
    .cab .marca svg { width: 100%; height: auto; display: block; }
    .cab > div:nth-of-type(1) { flex: 1; }
    .cab h1 { font-size: 20px; margin: 0 0 2px; letter-spacing: .06em; text-transform: uppercase; }
    .cab .sub { color: #4B5563; font-size: 12px; }
    .cab .dir { text-align: right; color: #8A94A6; font-size: 11px; }
    h2 { font-size: 14px; margin: 20px 0 6px; padding-bottom: 4px; border-bottom: 1px solid #DCE0E6; text-transform: uppercase; letter-spacing: .04em; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
    th, td { padding: 6px 8px; border-bottom: 1px solid #E5E8EC; text-align: left; }
    th { background: #F3F4F6; font-size: 10.5px; text-transform: uppercase; letter-spacing: .05em; }
    td.num, th.num { text-align: right; }
    tr.tot td { font-weight: 700; background: #FAFBFC; border-top: 2px solid #101215; }
    .resumo { display: flex; gap: 10px; margin-bottom: 8px; flex-wrap: wrap; }
    .box { border: 1px solid #DCE0E6; border-left: 3px solid #BE8A3C; border-radius: 6px; padding: 8px 12px; min-width: 130px; }
    .box .l { font-size: 10px; text-transform: uppercase; color: #8A94A6; letter-spacing: .06em; }
    .box .v { font-size: 17px; font-weight: 700; }
    .assin { margin-top: 40px; display: flex; gap: 40px; }
    .assin div { flex: 1; border-top: 1px solid #101215; padding-top: 4px; font-size: 11px; text-align: center; }
    .barbeiro { page-break-inside: avoid; }
    .rodape { margin-top: 24px; font-size: 10px; color: #8A94A6; text-align: center; }
    @media print { .noprint { display: none; } }
  </style></head><body>${corpoHTML}
  <div class="noprint" style="position:fixed;top:10px;right:10px"><button onclick="window.print()" style="padding:8px 16px;background:#A31621;color:#fff;border:0;border-radius:6px;cursor:pointer;font-size:13px">Imprimir / Salvar PDF</button></div>
  </body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 400);
  return { erro: false };
}
