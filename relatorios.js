/* =====================================================================
   relatorios.js — tela de relatórios, comissões e exportações
   ===================================================================== */

// ---------- Período ----------
function periodoRel() {
  let ini = viewState.relIni || '0000-01-01';
  let fim = viewState.relFim || '9999-12-31';
  if (ini > fim) [ini, fim] = [fim, ini]; // datas invertidas: corrige em vez de zerar o relatório
  return { ini, fim, label: `${fmtData(ini)} a ${fmtData(fim)}` };
}
function atalhoPeriodo(qual) {
  const h = new Date();
  const ini = (d) => fmtISO(d);
  if (qual === 'hoje') { viewState.relIni = viewState.relFim = hojeISO(); }
  else if (qual === 'semana') { viewState.relIni = ini(addDays(h, -6)); viewState.relFim = hojeISO(); }
  else if (qual === 'mes') { viewState.relIni = mesAtual() + '-01'; viewState.relFim = hojeISO(); }
  else if (qual === 'mesPassado') {
    const p = new Date(h.getFullYear(), h.getMonth() - 1, 1);
    viewState.relIni = fmtISO(p);
    viewState.relFim = fmtISO(new Date(h.getFullYear(), h.getMonth(), 0));
  } else if (qual === 'ano') { viewState.relIni = h.getFullYear() + '-01-01'; viewState.relFim = hojeISO(); }
  render();
}

// ---------- Dados do relatório geral ----------
function dadosRelatorio() {
  const { ini, fim, label } = periodoRel();
  const ats = db.atendimentos.filter((a) => a.data >= ini && a.data <= fim)
    .sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora));
  const lanc = db.caixa.filter((l) => l.data >= ini && l.data <= fim)
    .sort((a, b) => a.data.localeCompare(b.data) || a.id - b.id);
  const cx = resumoCaixa((l) => l.data >= ini && l.data <= fim);

  const total = ats.reduce((s, a) => s + a.valorFinal, 0);
  const descontos = ats.reduce((s, a) => s + a.desconto, 0);
  const soma = (obj, k, v) => (obj[k] = (obj[k] || 0) + v);
  const porBarb = {}, porServ = {}, porCli = {}, porPag = {}, porCat = {};
  ats.forEach((a) => {
    soma(porBarb, nomeBarbeiro(a) === '—' ? 'Sem barbeiro' : nomeBarbeiro(a), a.valorFinal);
    // Atendimento com vários itens: cada serviço/produto entra separado no ranking
    if (Array.isArray(a.itens) && a.itens.length) {
      const bruto = a.itens.reduce((s, i) => s + Number(i.total || 0), 0) || 1;
      const fator = Number(a.valorFinal) / bruto; // rateia o desconto entre os itens
      a.itens.forEach((i) => soma(porServ, i.nome, Number(i.total || 0) * fator));
    } else {
      soma(porServ, a.descricao, a.valorFinal);
    }
    soma(porCli, nomeCliente(a), a.valorFinal);
    soma(porPag, PAGAMENTOS[a.pagamento] || '—', a.valorFinal);
  });
  lanc.filter((l) => l.tipo === 'saida').forEach((l) => soma(porCat, l.categoria || 'Outros', l.valor));

  return {
    ini, fim, label, ats, lanc, cx, total, descontos,
    ticket: ats.length ? total / ats.length : 0,
    clientes: new Set(ats.map((a) => a.clienteId)).size,
    porBarb, porServ, porCli, porPag, porCat,
  };
}

// ---------- Dados de comissão ----------
function dadosComissao() {
  const { ini, fim, label } = periodoRel();
  let filtroBarb = viewState.relBarb;
  if (filtroBarb && !barbeiro(filtroBarb)) filtroBarb = viewState.relBarb = ''; // barbeiro excluído
  const pctManual = viewState.relPct === '' ? null : Number(viewState.relPct);

  const ats = db.atendimentos
    .filter((a) => a.data >= ini && a.data <= fim)
    .filter((a) => !filtroBarb || String(a.barbeiroId) === String(filtroBarb))
    .sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora));

  const grupos = new Map();
  ats.forEach((a) => {
    const chave = a.barbeiroId || 0;
    if (!grupos.has(chave)) {
      const b = barbeiro(a.barbeiroId);
      const nome = nomeBarbeiro(a);
      grupos.set(chave, { id: chave, nome: nome === '—' ? 'Sem barbeiro' : nome, pct: pctManual ?? (b?.comissao || 0), itens: [], total: 0 });
    }
    const g = grupos.get(chave);
    // A comissão incide sobre os serviços; produtos vendidos não entram na base
    g.itens.push(a); g.total += Number(a.baseComissao ?? a.valorFinal);
  });
  const lista = [...grupos.values()].sort((a, b) => b.total - a.total);
  lista.forEach((g) => (g.comissao = g.total * (g.pct / 100)));
  return {
    ini, fim, label, lista, alvo: filtroBarb ? barbeiro(filtroBarb)?.nome : null,
    totalAtend: ats.length,
    totalServ: lista.reduce((s, g) => s + g.total, 0),
    totalCom: lista.reduce((s, g) => s + g.comissao, 0),
  };
}

// ---------- Tela ----------
function barras(obj) {
  const arr = Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const max = arr[0]?.[1] || 1;
  return arr.length
    ? `<div class="bar-list">${arr.map(([k, v]) => `<div class="bar-row"><span>${esc(k)}</span><span class="strong">${R$(v)}</span><div class="bar-track"><div class="bar-fill" style="width:${(v / max) * 100}%"></div></div></div>`).join('')}</div>`
    : '<div class="muted">Sem dados no período.</div>';
}

function telaRelatorios() {
  const d = dadosRelatorio();
  const c = dadosComissao();
  const lucro = d.total - d.cx.saidas;

  return {
    html: `
    <div class="panel"><div class="panel-head">
      <div class="filters">
        <label class="muted">De</label><input type="date" id="rIni" value="${d.ini}">
        <label class="muted">até</label><input type="date" id="rFim" value="${d.fim}">
      </div>
      <div class="filters">
        <button class="btn btn-sm" onclick="atalhoPeriodo('hoje')">Hoje</button>
        <button class="btn btn-sm" onclick="atalhoPeriodo('semana')">7 dias</button>
        <button class="btn btn-sm" onclick="atalhoPeriodo('mes')">Este mês</button>
        <button class="btn btn-sm" onclick="atalhoPeriodo('mesPassado')">Mês passado</button>
        <button class="btn btn-sm" onclick="atalhoPeriodo('ano')">Este ano</button>
      </div></div>
      <div class="panel-body"><div class="filters">
        <button class="btn btn-primary" onclick="exportarRelatorioPDF()">📄 Relatório geral em PDF</button>
        <button class="btn" onclick="exportarRelatorioExcel()">📊 Relatório geral em Excel</button>
        <span class="muted">Período: <strong>${d.label}</strong></span>
      </div></div>
    </div>

    <div class="cards">
      <div class="card accent"><div class="card-label">Faturamento</div><div class="card-value">${R$(d.total)}</div><div class="card-sub">${d.ats.length} atendimento(s) · ${d.clientes} cliente(s)</div></div>
      <div class="card"><div class="card-label">Ticket médio</div><div class="card-value">${R$(d.ticket)}</div><div class="card-sub">Descontos: ${R$(d.descontos)}</div></div>
      <div class="card danger"><div class="card-label">Despesas</div><div class="card-value">${R$(d.cx.saidas)}</div></div>
      <div class="card ok"><div class="card-label">Resultado</div><div class="card-value">${R$(lucro)}</div><div class="card-sub">Faturamento menos despesas</div></div>
    </div>

    <div class="grid-2">
      <div class="panel"><div class="panel-head"><h3>Por barbeiro</h3></div><div class="panel-body">${barras(d.porBarb)}</div></div>
      <div class="panel"><div class="panel-head"><h3>Por serviço</h3></div><div class="panel-body">${barras(d.porServ)}</div></div>
      <div class="panel"><div class="panel-head"><h3>Melhores clientes</h3></div><div class="panel-body">${barras(d.porCli)}</div></div>
      <div class="panel"><div class="panel-head"><h3>Por forma de pagamento</h3></div><div class="panel-body">${barras(d.porPag)}</div></div>
      <div class="panel"><div class="panel-head"><h3>Despesas por categoria</h3></div><div class="panel-body">${barras(d.porCat)}</div></div>
    </div>

    <div class="panel"><div class="panel-head"><h3>Comissões</h3>
      <div class="filters">
        <select id="rBarb"><option value="">Todos os barbeiros</option>${db.barbeiros.map((b) => `<option value="${b.id}" ${String(viewState.relBarb) === String(b.id) ? 'selected' : ''}>${esc(b.nome)}</option>`).join('')}</select>
        <input type="number" id="rPct" min="0" max="100" step="0.5" placeholder="% comissão" value="${viewState.relPct}" style="width:130px">
      </div></div>
      <div class="panel-body">
        <div class="filters" style="margin-bottom:14px">
          <button class="btn btn-primary" onclick="exportarComissaoPDF()">📄 Comissões em PDF</button>
          <button class="btn" onclick="exportarComissaoExcel()">📊 Comissões em Excel</button>
          <span class="muted">Deixe <strong>% comissão</strong> vazio para usar o percentual cadastrado de cada barbeiro.</span>
        </div>
        ${c.lista.length ? `<div class="table-wrap"><table>
          <thead><tr><th>Barbeiro</th><th class="num">Atendimentos</th><th class="num">Serviços</th><th class="num">Comissão %</th><th class="num">A pagar</th><th class="num">Fica com a barbearia</th></tr></thead><tbody>
          ${c.lista.map((g) => `<tr><td class="strong">${esc(g.nome)}</td><td class="num">${g.itens.length}</td><td class="num">${R$(g.total)}</td>
            <td class="num">${g.pct.toLocaleString('pt-BR')}%</td><td class="num strong" style="color:var(--accent)">${R$(g.comissao)}</td><td class="num">${R$(g.total - g.comissao)}</td></tr>`).join('')}
          <tr style="border-top:2px solid var(--ink)"><td class="strong">TOTAL</td><td class="num strong">${c.totalAtend}</td><td class="num strong">${R$(c.totalServ)}</td><td></td>
            <td class="num strong" style="color:var(--accent)">${R$(c.totalCom)}</td><td class="num strong">${R$(c.totalServ - c.totalCom)}</td></tr>
          </tbody></table></div>` : '<div class="empty">Nenhum atendimento no período selecionado.</div>'}
      </div>
    </div>`,
    after() {
      const atualiza = () => {
        viewState.relIni = document.getElementById('rIni').value;
        viewState.relFim = document.getElementById('rFim').value;
        viewState.relBarb = document.getElementById('rBarb').value;
        viewState.relPct = document.getElementById('rPct').value;
        render();
      };
      ['rIni', 'rFim', 'rBarb', 'rPct'].forEach((id) => (document.getElementById(id).onchange = atualiza));
    },
  };
}

// ---------- Nome de arquivo ----------
function nomeArquivo(base, extra, ini, fim, ext) {
  const limpo = (extra || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
  return `${base}${limpo ? '-' + limpo : ''}-${ini}-a-${fim}.${ext}`;
}

// ---------- Exportar relatório geral ----------
function exportarRelatorioExcel() {
  const d = dadosRelatorio();
  if (!d.ats.length && !d.lanc.length) return toast('Nenhum dado no período selecionado.');
  const bloco = (titulo, obj) => [[], [B(titulo)], [B('Item'), B('Valor')], ...Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, v]) => [T(k), M(v)])];

  const resumo = [
    [B('SPARTA BARBEARIA — RELATÓRIO GERAL')],
    [T('Período'), T(d.label)],
    [T('Gerado em'), T(new Date().toLocaleString('pt-BR'))],
    [],
    [B('Indicador'), B('Valor')],
    [T('Faturamento'), M(d.total)],
    [T('Atendimentos'), N(d.ats.length)],
    [T('Clientes atendidos'), N(d.clientes)],
    [T('Ticket médio'), M(d.ticket)],
    [T('Descontos concedidos'), M(d.descontos)],
    [T('Entradas no caixa'), M(d.cx.entradas)],
    [T('Despesas'), M(d.cx.saidas)],
    [B('Resultado'), BM(d.total - d.cx.saidas)],
    [],
    [B('Recebimentos por forma de pagamento')],
    [T('Dinheiro'), M(d.cx.dinheiro)], [T('Pix'), M(d.cx.pix)], [T('Débito'), M(d.cx.debito)], [T('Crédito'), M(d.cx.credito)],
    ...bloco('Por barbeiro', d.porBarb),
    ...bloco('Por serviço', d.porServ),
    ...bloco('Por cliente', d.porCli),
    ...bloco('Despesas por categoria', d.porCat),
  ];
  const atendimentos = [
    [B('Data'), B('Hora'), B('Cliente'), B('Serviço'), B('Barbeiro'), B('Valor'), B('Desconto'), B('Valor final'), B('Pagamento')],
    ...d.ats.map((a) => [T(fmtData(a.data)), T(a.hora), T(nomeCliente(a)), T(a.descricao), T(nomeBarbeiro(a)),
      M(a.valor), M(a.desconto), M(a.valorFinal), T(PAGAMENTOS[a.pagamento] || '—')]),
    [B('TOTAL'), T(''), T(''), T(''), T(''), T(''), BM(d.descontos), BM(d.total), T('')],
  ];
  const caixa = [
    [B('Data'), B('Tipo'), B('Descrição'), B('Categoria'), B('Pagamento'), B('Valor')],
    ...d.lanc.map((l) => [T(fmtData(l.data)), T(l.tipo === 'entrada' ? 'Entrada' : 'Saída'), T(l.descricao), T(l.categoria || ''),
      T(PAGAMENTOS[l.pagamento] || '—'), M(l.tipo === 'entrada' ? l.valor : -l.valor)]),
    [B('SALDO'), T(''), T(''), T(''), T(''), BM(d.cx.saldo)],
  ];
  xlsxBaixar(nomeArquivo('relatorio-geral', '', d.ini, d.fim, 'xlsx'), [
    { nome: 'Resumo', linhas: resumo },
    { nome: 'Atendimentos', linhas: atendimentos },
    { nome: 'Caixa', linhas: caixa },
  ]);
  toast('Planilha gerada');
}

function exportarRelatorioPDF() {
  const d = dadosRelatorio();
  if (!d.ats.length && !d.lanc.length) return toast('Nenhum dado no período selecionado.');
  const tabela = (titulo, obj) => {
    const arr = Object.entries(obj).sort((a, b) => b[1] - a[1]);
    if (!arr.length) return '';
    return `<h2>${titulo}</h2><table><thead><tr><th>Item</th><th class="num">Valor</th><th class="num">%</th></tr></thead><tbody>
      ${arr.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${R$(v)}</td><td class="num">${d.total ? ((v / d.total) * 100).toFixed(1) : '0,0'}%</td></tr>`).join('')}
      </tbody></table>`;
  };
  const corpo = `
    <div class="cab"><span class="marca">${LOGO_SVG}</span><div><h1>Relatório geral</h1><div class="sub">Período: ${d.label}</div></div>
      <div class="dir">Emitido em ${new Date().toLocaleString('pt-BR')}</div></div>

    <div class="resumo">
      <div class="box"><div class="l">Faturamento</div><div class="v">${R$(d.total)}</div></div>
      <div class="box"><div class="l">Atendimentos</div><div class="v">${d.ats.length}</div></div>
      <div class="box"><div class="l">Ticket médio</div><div class="v">${R$(d.ticket)}</div></div>
      <div class="box"><div class="l">Despesas</div><div class="v">${R$(d.cx.saidas)}</div></div>
      <div class="box"><div class="l">Resultado</div><div class="v">${R$(d.total - d.cx.saidas)}</div></div>
    </div>

    <h2>Recebimentos por forma de pagamento</h2>
    <table><thead><tr><th>Forma</th><th class="num">Dinheiro</th><th class="num">Pix</th><th class="num">Débito</th><th class="num">Crédito</th><th class="num">Saldo</th></tr></thead>
      <tbody><tr><td>Movimento do caixa</td><td class="num">${R$(d.cx.dinheiro)}</td><td class="num">${R$(d.cx.pix)}</td><td class="num">${R$(d.cx.debito)}</td><td class="num">${R$(d.cx.credito)}</td><td class="num">${R$(d.cx.saldo)}</td></tr></tbody></table>

    ${tabela('Por barbeiro', d.porBarb)}
    ${tabela('Por serviço', d.porServ)}
    ${tabela('Melhores clientes', d.porCli)}
    ${tabela('Despesas por categoria', d.porCat)}

    <h2>Atendimentos do período</h2>
    <table><thead><tr><th>Data</th><th>Cliente</th><th>Serviço</th><th>Barbeiro</th><th>Pgto</th><th class="num">Valor</th></tr></thead><tbody>
      ${d.ats.map((a) => `<tr><td>${fmtData(a.data)} ${a.hora}</td><td>${esc(nomeCliente(a))}</td><td>${esc(a.descricao)}</td><td>${esc(nomeBarbeiro(a))}</td><td>${PAGAMENTOS[a.pagamento] || '—'}</td><td class="num">${R$(a.valorFinal)}</td></tr>`).join('')}
      <tr class="tot"><td colspan="5">Total de ${d.ats.length} atendimento(s)</td><td class="num">${R$(d.total)}</td></tr>
    </tbody></table>

    <div class="rodape">Sparta Barbearia · relatório gerado pelo sistema de gestão.</div>`;
  if (pdfImprimir('Sparta Barbearia — Relatório geral ' + d.label, corpo).erro) toast('Libere as janelas pop-up do navegador para gerar o PDF.');
}

// ---------- Exportar comissões ----------
function exportarComissaoExcel() {
  const d = dadosComissao();
  if (!d.lista.length) return toast('Nenhum atendimento no período selecionado.');
  const resumo = [
    [B('SPARTA BARBEARIA — RELATÓRIO DE COMISSÕES')],
    [T('Período'), T(d.label)],
    [T('Barbeiro'), T(d.alvo || 'Todos')],
    [T('Gerado em'), T(new Date().toLocaleString('pt-BR'))],
    [],
    [B('Barbeiro'), B('Atendimentos'), B('Total em serviços'), B('Comissão %'), B('Comissão a pagar'), B('Fica com a barbearia')],
    ...d.lista.map((g) => [T(g.nome), N(g.itens.length), M(g.total), P(g.pct), M(g.comissao), M(g.total - g.comissao)]),
    [B('TOTAL'), N(d.totalAtend), BM(d.totalServ), T(''), BM(d.totalCom), BM(d.totalServ - d.totalCom)],
  ];
  const detalhe = [
    [B('Data'), B('Hora'), B('Barbeiro'), B('Cliente'), B('Serviço'), B('Valor'), B('Desconto'), B('Valor final'), B('Pagamento'), B('Comissão %'), B('Comissão')],
    ...d.lista.flatMap((g) => g.itens.map((a) => [
      T(fmtData(a.data)), T(a.hora), T(g.nome), T(nomeCliente(a)), T(a.descricao),
      M(a.valor), M(a.desconto), M(a.valorFinal), T(PAGAMENTOS[a.pagamento] || '—'), P(g.pct), M(Number(a.baseComissao ?? a.valorFinal) * (g.pct / 100)),
    ])),
    [B('TOTAL'), T(''), T(''), T(''), T(''), T(''), T(''), BM(d.totalServ), T(''), T(''), BM(d.totalCom)],
  ];
  xlsxBaixar(nomeArquivo('comissoes', d.alvo || 'geral', d.ini, d.fim, 'xlsx'),
    [{ nome: 'Resumo', linhas: resumo }, { nome: 'Detalhado', linhas: detalhe }]);
  toast('Planilha gerada');
}

function exportarComissaoPDF() {
  const d = dadosComissao();
  if (!d.lista.length) return toast('Nenhum atendimento no período selecionado.');
  const corpo = `
    <div class="cab"><span class="marca">${LOGO_SVG}</span><div><h1>Relatório de comissões</h1><div class="sub">Período: ${d.label} · ${esc(d.alvo || 'Todos os barbeiros')}</div></div>
      <div class="dir">Emitido em ${new Date().toLocaleString('pt-BR')}</div></div>

    <div class="resumo">
      <div class="box"><div class="l">Atendimentos</div><div class="v">${d.totalAtend}</div></div>
      <div class="box"><div class="l">Total em serviços</div><div class="v">${R$(d.totalServ)}</div></div>
      <div class="box"><div class="l">Comissões a pagar</div><div class="v">${R$(d.totalCom)}</div></div>
      <div class="box"><div class="l">Fica com a barbearia</div><div class="v">${R$(d.totalServ - d.totalCom)}</div></div>
    </div>

    <h2>Resumo por barbeiro</h2>
    <table><thead><tr><th>Barbeiro</th><th class="num">Atend.</th><th class="num">Serviços</th><th class="num">Comissão %</th><th class="num">A pagar</th><th class="num">Barbearia</th></tr></thead><tbody>
      ${d.lista.map((g) => `<tr><td>${esc(g.nome)}</td><td class="num">${g.itens.length}</td><td class="num">${R$(g.total)}</td><td class="num">${g.pct.toLocaleString('pt-BR')}%</td><td class="num">${R$(g.comissao)}</td><td class="num">${R$(g.total - g.comissao)}</td></tr>`).join('')}
      <tr class="tot"><td>TOTAL</td><td class="num">${d.totalAtend}</td><td class="num">${R$(d.totalServ)}</td><td></td><td class="num">${R$(d.totalCom)}</td><td class="num">${R$(d.totalServ - d.totalCom)}</td></tr>
    </tbody></table>

    ${d.lista.map((g) => `<div class="barbeiro"><h2>${esc(g.nome)} — detalhamento</h2>
      <table><thead><tr><th>Data</th><th>Cliente</th><th>Serviço</th><th>Pagamento</th><th class="num">Valor</th><th class="num">Comissão</th></tr></thead><tbody>
      ${g.itens.map((a) => `<tr><td>${fmtData(a.data)} ${a.hora}</td><td>${esc(nomeCliente(a))}</td><td>${esc(a.descricao)}</td><td>${PAGAMENTOS[a.pagamento] || '—'}</td><td class="num">${R$(a.valorFinal)}</td><td class="num">${R$(Number(a.baseComissao ?? a.valorFinal) * (g.pct / 100))}</td></tr>`).join('')}
      <tr class="tot"><td colspan="4">Total de ${esc(g.nome)} — comissão ${g.pct.toLocaleString('pt-BR')}%</td><td class="num">${R$(g.total)}</td><td class="num">${R$(g.comissao)}</td></tr>
      </tbody></table></div>`).join('')}

    <div class="assin"><div>Assinatura da gerência</div><div>Assinatura do barbeiro</div></div>
    <div class="rodape">Sparta Barbearia · relatório gerado pelo sistema de gestão.</div>`;
  if (pdfImprimir('Sparta Barbearia — Comissões ' + d.label, corpo).erro) toast('Libere as janelas pop-up do navegador para gerar o PDF.');
}
