/* =====================================================================
   estoque.js — controle de estoque de produtos
   Produtos, entradas (compras), vendas, baixas e ajustes de inventário.
   Vendas e compras podem lançar automaticamente no caixa.
   ===================================================================== */

const UNIDADES = ['un', 'ml', 'g', 'kg', 'L', 'cx', 'par'];
const CAT_PRODUTO = ['Pomada / Gel', 'Shampoo / Condicionador', 'Barba', 'Lâminas / Descartáveis', 'Bebidas', 'Acessórios', 'Outros'];
const TIPOS_MOV = { entrada: 'Entrada', venda: 'Venda', baixa: 'Baixa', ajuste: 'Ajuste' };
const MOTIVOS_BAIXA = ['Uso interno no atendimento', 'Perda / quebra', 'Vencimento', 'Brinde / cortesia', 'Outro'];

const produto = (id) => byId(db.produtos, id);
const produtosAtivos = () => db.produtos.filter((p) => p.ativo !== false);
const abaixoDoMinimo = () => produtosAtivos().filter((p) => Number(p.estoque) <= Number(p.estoqueMin || 0));
const valorEstoque = (campo) => db.produtos.reduce((s, p) => s + Number(p.estoque || 0) * Number(p[campo] || 0), 0);
const nomeUsuarioAtual = () =>
  perfil === 'gerencia' ? (gerente(gerenteAtualId)?.nome || 'Gerência') : (barbeiro(barbeiroAtualId)?.nome || 'Barbeiro');

// Registra a movimentação e atualiza o saldo do produto.
// `delta` é o quanto soma (+) ou subtrai (−) do estoque.
async function registrarMov(prod, tipo, quantidade, delta, extras = {}) {
  const saldo = Number(prod.estoque || 0) + delta;
  const mov = await inserir('estoque_mov', {
    produtoId: prod.id,
    produtoNome: prod.nome,
    tipo,
    quantidade: Math.abs(Number(quantidade)),
    saldo,
    valorUnit: Number(extras.valorUnit || 0),
    total: Number(extras.total || 0),
    motivo: extras.motivo || '',
    data: extras.data || hojeISO(),
    usuarioNome: nomeUsuarioAtual(),
    caixaId: extras.caixaId ?? null,
  });
  db.estoqueMov.push(mov);

  const campos = { estoque: saldo };
  if (extras.custo != null) campos.custo = Number(extras.custo);
  await atualizar('produtos', prod.id, campos);
  Object.assign(prod, campos);
  return mov;
}

// =====================================================================
// TELA
// =====================================================================
// OK quando a última contagem bate com o saldo atual; alerta quando não bate
// ou quando existe contagem esperando decisão da gerência.
function situacaoConferencia(p) {
  const pendente = contagensPendentes().some((c) => (c.itens || []).some((i) => Number(i.produtoId) === Number(p.id) && Number(i.diferenca) !== 0));
  if (pendente) return '<span class="badge badge-confirmado" title="Contagem aguardando conferência">⚠ pendente</span>';
  const cont = ultimaContagemDe(p.id);
  if (!cont) return '<span class="muted" style="font-size:12px">sem contagem</span>';
  const bate = Math.abs(Number(p.estoque || 0) - Number(cont.contagem)) < 0.001;
  return bate
    ? `<span class="badge badge-ativo" title="Última contagem em ${fmtData(cont.data)}">OK</span>`
    : `<span class="badge badge-cancelado" title="Contado ${cont.contagem} em ${fmtData(cont.data)}">⚠ divergente</span>`;
}

function telaEstoque() {
  // As tabelas ainda não existem no Supabase
  if (db.estoqueOk === false) {
    return {
      html: `<div class="panel"><div class="empty" style="padding:40px;text-align:left">
        <h3 style="margin-bottom:10px">Estoque ainda não configurado</h3>
        <p>As tabelas <strong>produtos</strong> e <strong>estoque_mov</strong> não foram encontradas no seu banco.</p>
        <p class="muted">Abra o Supabase → <strong>SQL Editor</strong> → cole o conteúdo do arquivo
        <strong>estoque.sql</strong> que veio junto com o sistema → <strong>RUN</strong>. Depois recarregue esta página.</p>
      </div></div>`,
    };
  }

  const ger = desbloqueado();
  const q = (viewState.estoqueBusca || '').toLowerCase();
  const somenteBaixo = viewState.estoqueBaixo === true;
  let list = [...db.produtos];
  if (q) list = list.filter((p) => p.nome.toLowerCase().includes(q) || (p.categoria || '').toLowerCase().includes(q));
  if (somenteBaixo) list = list.filter((p) => p.ativo !== false && Number(p.estoque) <= Number(p.estoqueMin || 0));
  list.sort((a, b) => a.nome.localeCompare(b.nome));

  const baixos = abaixoDoMinimo();
  const movs = [...db.estoqueMov].sort((a, b) => String(b.data).localeCompare(String(a.data)) || b.id - a.id).slice(0, 25);

  const cards = ger ? `
    <div class="cards">
      <div class="card accent"><div class="card-label">Produtos ativos</div><div class="card-value">${produtosAtivos().length}</div><div class="card-sub">${db.produtos.length} cadastrado(s)</div></div>
      <div class="card"><div class="card-label">Valor em estoque (custo)</div><div class="card-value">${R$(valorEstoque('custo'))}</div><div class="card-sub">Quanto está investido</div></div>
      <div class="card ok"><div class="card-label">Valor em estoque (venda)</div><div class="card-value">${R$(valorEstoque('preco'))}</div><div class="card-sub">Se vender tudo</div></div>
      <div class="card ${baixos.length ? 'danger' : ''}"><div class="card-label">Abaixo do mínimo</div><div class="card-value">${baixos.length}</div><div class="card-sub">${baixos.length ? 'Precisa repor' : 'Estoque em dia'}</div></div>
    </div>` : '';

  const alerta = (ger && baixos.length) ? `
    <div class="panel" style="border-left:4px solid var(--danger)">
      <div class="panel-body">
        <strong>Repor estoque:</strong>
        ${baixos.map((p) => `${esc(p.nome)} <span class="muted">(${Number(p.estoque)} ${esc(p.unidade || 'un')})</span>`).join(' · ')}
      </div>
    </div>` : '';

  const colunasGer = ger ? '<th class="num">Custo</th><th class="num">Margem</th><th>Conferência</th>' : '';
  const pendentes = contagensPendentes();
  const recontar = itensParaRecontar();

  // Gerência: contagens esperando decisão
  const painelPendentes = (ger && pendentes.length) ? `
    <div class="panel" style="border-left:4px solid var(--warn)">
      <div class="panel-head"><h3>Contagens aguardando sua conferência</h3><span class="badge badge-confirmado">${pendentes.length}</span></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Data</th><th>Quem contou</th><th class="num">Produtos</th><th class="num">Divergências</th><th></th></tr></thead>
        <tbody>${pendentes.map((c) => {
          const div = (c.itens || []).filter((i) => Number(i.diferenca) !== 0).length;
          return `<tr>
            <td>${fmtData(c.data)}</td><td class="strong">${esc(c.usuarioNome || '—')}</td>
            <td class="num">${(c.itens || []).length}</td>
            <td class="num ${div ? 'strong' : ''}" style="${div ? 'color:var(--danger)' : ''}">${div || 'nenhuma'}</td>
            <td class="actions"><button class="btn btn-sm btn-primary" onclick="modalRevisarContagem(${c.id})">Conferir</button></td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
    </div>` : '';

  // Barbeiro: a gerência pediu recontagem
  const painelRecontagem = (!ger && recontar.size) ? `
    <div class="panel" style="border-left:4px solid var(--warn)">
      <div class="panel-body">
        <strong>A gerência pediu recontagem de ${recontar.size} produto(s).</strong>
        <span class="muted">Confira de novo na prateleira e envie.</span>
        <div style="margin-top:10px"><button class="btn btn-primary" onclick="modalContagem(true)">Recontar agora</button></div>
      </div>
    </div>` : '';
  const colunasEstoque = ger ? '<th class="num">Estoque</th><th class="num">Mínimo</th>' : '<th>Disponibilidade</th>';

  return {
    actions: ger
      ? `<button class="btn" onclick="exportarExtratoExcel()">Extrato</button>
         <button class="btn" onclick="modalContagem()">Contagem</button>
         <button class="btn" onclick="modalVendaProduto()">Vender</button>
         <button class="btn" onclick="modalEntradaEstoque()">Entrada</button>
         ${btnAdd('Produto', 'modalProduto()')}`
      : `${itensParaRecontar().size ? `<button class="btn btn-primary" onclick="modalContagem(true)">Recontar (${itensParaRecontar().size})</button>` : ''}
         <button class="btn" onclick="modalContagem()">Contagem</button>
         <button class="btn" onclick="modalVendaProduto()">Vender produto</button>`,
    html: `
      ${cards}
      ${painelPendentes}
      ${painelRecontagem}
      ${alerta}
      <div class="panel">
        <div class="panel-head"><h3>${list.length} produto(s)</h3>
          <div class="filters">
            <input class="search" id="buscaProduto" placeholder="Buscar produto…" value="${esc(viewState.estoqueBusca || '')}">
            ${ger ? `<label class="check"><input type="checkbox" id="filtroBaixo" ${somenteBaixo ? 'checked' : ''}> Só abaixo do mínimo</label>` : ''}
            ${ger ? `<button class="btn btn-sm" onclick="exportarInventarioExcel()">Inventário</button>
            <button class="btn btn-sm" onclick="exportarExtratoExcel()">Extrato</button>` : ''}
          </div>
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th>Produto</th><th>Categoria</th>${colunasEstoque}${colunasGer}<th class="num">Preço</th><th>Status</th><th></th></tr></thead>
          <tbody>
          ${list.length ? list.map((p) => {
            const estoque = Number(p.estoque || 0), min = Number(p.estoqueMin || 0);
            const critico = p.ativo !== false && estoque <= min;
            const margem = Number(p.preco || 0) - Number(p.custo || 0);
            return `<tr>
              <td class="strong">${esc(p.nome)}${p.obs ? `<div class="muted" style="font-size:12px">${esc(p.obs)}</div>` : ''}</td>
              <td>${esc(p.categoria || '—')}</td>
              ${ger
                ? `<td class="num ${critico ? 'strong' : ''}" style="${critico ? 'color:var(--danger)' : ''}">${estoque.toLocaleString('pt-BR')} ${esc(p.unidade || 'un')}</td>
                   <td class="num muted">${min.toLocaleString('pt-BR')}</td>`
                : `<td><span class="badge badge-${estoque > 0 ? 'ativo' : 'cancelado'}">${estoque > 0 ? 'Disponível' : 'Esgotado'}</span></td>`}
              ${ger ? `<td class="num">${R$(p.custo)}</td><td class="num" style="color:${margem > 0 ? 'var(--ok)' : 'var(--ink-3)'}">${R$(margem)}</td>
                   <td>${situacaoConferencia(p)}</td>` : ''}
              <td class="num strong">${R$(p.preco)}</td>
              <td><span class="badge badge-${p.ativo !== false ? 'ativo' : 'inativo'}">${p.ativo !== false ? 'Ativo' : 'Inativo'}</span></td>
              <td class="actions">
                <button class="btn btn-sm" onclick="modalVendaProduto(${p.id})">Vender</button>
                ${ger ? `
                <button class="btn btn-sm" onclick="modalEntradaEstoque(${p.id})">Entrada</button>
                <button class="btn btn-sm" onclick="modalBaixaEstoque(${p.id})">Baixa</button>
                <button class="btn btn-sm" onclick="modalProduto(${p.id})">Editar</button>
                <button class="btn btn-sm btn-danger" onclick="excluirProduto(${p.id})">Excluir</button>` : ''}
              </td>
            </tr>`;
          }).join('') : `<tr><td colspan="${ger ? 10 : 6}" class="empty">Nenhum produto encontrado.</td></tr>`}
          </tbody>
        </table></div>
      </div>

      ${ger ? `<div class="panel">
        <div class="panel-head"><h3>Últimas movimentações</h3><span class="muted">${db.estoqueMov.length} no total</span></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Data</th><th>Produto</th><th>Tipo</th><th class="num">Qtd.</th><th class="num">Saldo</th><th class="num">Valor</th><th>Motivo</th><th>Quem</th></tr></thead>
          <tbody>
          ${movs.length ? movs.map((m) => `<tr>
            <td>${fmtData(m.data)}</td>
            <td class="strong">${esc(m.produtoNome || produto(m.produtoId)?.nome || '—')}</td>
            <td><span class="badge badge-${m.tipo === 'entrada' ? 'entrada' : m.tipo === 'venda' ? 'concluido' : 'saida'}">${TIPOS_MOV[m.tipo] || m.tipo}</span></td>
            <td class="num">${m.tipo === 'entrada' ? '+' : m.tipo === 'ajuste' ? '' : '−'}${Number(m.quantidade).toLocaleString('pt-BR')}</td>
            <td class="num muted">${Number(m.saldo ?? 0).toLocaleString('pt-BR')}</td>
            <td class="num">${m.total ? R$(m.total) : '—'}</td>
            <td>${esc(m.motivo || '—')}</td>
            <td class="muted">${esc(m.usuarioNome || '—')}</td>
          </tr>`).join('') : '<tr><td colspan="8" class="empty">Nenhuma movimentação registrada.</td></tr>'}
          </tbody>
        </table></div>
      </div>` : ''}`,
    after() {
      const b = document.getElementById('buscaProduto');
      b.addEventListener('input', () => {
        viewState.estoqueBusca = b.value;
        const pos = b.selectionStart;
        render();
        const n = document.getElementById('buscaProduto');
        n.focus(); n.setSelectionRange(pos, pos);
      });
      const fb = document.getElementById('filtroBaixo');
      if (fb) fb.onchange = (ev) => { viewState.estoqueBaixo = ev.target.checked; render(); };
    },
  };
}

// =====================================================================
// CADASTRO DE PRODUTO
// =====================================================================
function modalProduto(id) {
  if (!desbloqueado()) return comSenha(() => modalProduto(id), 'Cadastrar ou alterar produtos exige acesso gerencial.');
  const p = id ? produto(id) : { nome: '', categoria: 'Pomada / Gel', unidade: 'un', custo: '', preco: '', estoque: 0, estoqueMin: 0, ativo: true, obs: '' };
  openModal({
    title: id ? 'Editar produto' : 'Novo produto',
    body: `<div class="form-grid">
      ${field('Nome *', `<input name="nome" value="${esc(p.nome)}" placeholder="Ex.: Pomada modeladora 120g">`, true)}
      ${field('Categoria', `<select name="categoria">${CAT_PRODUTO.map((c) => `<option ${p.categoria === c ? 'selected' : ''}>${c}</option>`).join('')}</select>`)}
      ${field('Unidade', `<select name="unidade">${UNIDADES.map((u) => `<option ${p.unidade === u ? 'selected' : ''}>${u}</option>`).join('')}</select>`)}
      ${field('Custo de compra (R$)', `<input type="number" step="0.01" min="0" name="custo" id="prodCusto" value="${p.custo}">`)}
      ${field('Preço de venda (R$) *', `<input type="number" step="0.01" min="0" name="preco" id="prodPreco" value="${p.preco}">`)}
      ${id
        ? field('Estoque atual', `<input value="${Number(p.estoque || 0)} ${esc(p.unidade || 'un')}" disabled><span class="hint">Use Entrada, Baixa ou Ajuste para alterar.</span>`)
        : field('Estoque inicial', `<input type="number" step="0.01" min="0" name="estoque" value="0">`)}
      ${field('Estoque mínimo', `<input type="number" step="0.01" min="0" name="estoqueMin" value="${Number(p.estoqueMin || 0)}"><span class="hint">Avisa quando chegar nesse nível.</span>`)}
      ${field('Observação', `<input name="obs" value="${esc(p.obs || '')}" placeholder="Fornecedor, marca, etc.">`, true)}
      <div class="field"><label>Status</label><label class="check"><input type="checkbox" name="ativo" ${p.ativo !== false ? 'checked' : ''}> Produto ativo</label></div>
      <div class="field"><label>Margem por unidade</label><div class="total-box"><span class="muted">Lucro</span><span class="v" id="prodMargem">—</span></div></div>
    </div>`,
    foot: `<button class="btn" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="salvarProduto(${id || 0})">Salvar</button>`,
    onOpen() {
      const calc = () => {
        const c = Number(document.getElementById('prodCusto').value) || 0;
        const v = Number(document.getElementById('prodPreco').value) || 0;
        const m = v - c;
        const el = document.getElementById('prodMargem');
        el.textContent = v ? `${R$(m)}${c ? ` (${Math.round((m / v) * 100)}%)` : ''}` : '—';
      };
      document.getElementById('prodCusto').oninput = calc;
      document.getElementById('prodPreco').oninput = calc;
      calc();
    },
  });
}

async function salvarProduto(id) {
  const f = formData();
  if (!f.nome || f.preco === '') return toast('Informe o nome e o preço de venda.');
  const dados = {
    nome: f.nome, categoria: f.categoria, unidade: f.unidade,
    custo: Number(f.custo) || 0, preco: Number(f.preco) || 0,
    estoqueMin: Number(f.estoqueMin) || 0, ativo: f.ativo, obs: f.obs || '',
  };
  try {
    if (id) {
      Object.assign(produto(id), dados);
      await atualizar('produtos', id, dados);
    } else {
      const inicial = Number(f.estoque) || 0;
      const novo = await inserir('produtos', { ...dados, estoque: inicial, criadoEm: new Date().toISOString() });
      db.produtos.push(novo);
      if (inicial > 0) {
        // deixa o estoque inicial registrado no histórico
        novo.estoque = 0;
        await registrarMov(novo, 'entrada', inicial, inicial, {
          valorUnit: dados.custo, total: dados.custo * inicial, motivo: 'Estoque inicial do cadastro',
        });
      }
    }
    closeModal(); render(); toast('Produto salvo');
  } catch (e) { erroSync(e); }
}

function excluirProduto(id) {
  if (!desbloqueado()) return comSenha(() => excluirProduto(id));
  const p = produto(id);
  confirmar(`Excluir o produto <strong>${esc(p.nome)}</strong>?<br><br>O histórico de movimentações dele também será removido. Se quiser apenas parar de vender, use <strong>Editar</strong> e desmarque "Produto ativo".`, async () => {
    try {
      await remover('produtos', id);
      db.produtos = db.produtos.filter((x) => Number(x.id) !== Number(id));
      db.estoqueMov = db.estoqueMov.filter((m) => Number(m.produtoId) !== Number(id));
      render(); toast('Produto excluído');
    } catch (e) { erroSync(e); }
  }, { okLabel: 'Excluir' });
}

// =====================================================================
// ENTRADA (COMPRA)
// =====================================================================
function modalEntradaEstoque(id) {
  if (!desbloqueado()) return comSenha(() => modalEntradaEstoque(id), 'Registrar entrada de estoque exige acesso gerencial.');
  if (!db.produtos.length) return toast('Cadastre um produto primeiro.');
  const p = id ? produto(id) : db.produtos[0];
  openModal({
    title: 'Entrada de estoque',
    body: `<div class="form-grid">
      ${field('Produto *', `<select name="produtoId" id="entProduto">${opts(db.produtos, p?.id, (x) => `${x.nome} — ${Number(x.estoque || 0)} ${x.unidade || 'un'}`)}</select>`, true)}
      ${field('Quantidade *', `<input type="number" step="0.01" min="0.01" name="quantidade" id="entQtd" value="1">`)}
      ${field('Custo unitário (R$)', `<input type="number" step="0.01" min="0" name="valorUnit" id="entCusto" value="${Number(p?.custo || 0)}">`)}
      ${field('Data *', `<input type="date" name="data" value="${hojeISO()}">`)}
      ${field('Fornecedor / observação', `<input name="motivo" placeholder="Ex.: Compra na distribuidora">`)}
      <div class="field full"><label class="check"><input type="checkbox" name="lancarCaixa" id="entCaixa" checked> Lançar a compra como despesa no caixa</label></div>
      ${field('Forma de pagamento', `<select name="pagamento">${Object.entries(PAGAMENTOS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>`, true)}
      <div class="field full"><div class="total-box"><span>Total da compra</span><span class="v" id="entTotal">R$ 0,00</span></div></div>
    </div>`,
    foot: `<button class="btn" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="salvarEntradaEstoque()">Registrar entrada</button>`,
    onOpen() {
      const sel = document.getElementById('entProduto'), qtd = document.getElementById('entQtd'), custo = document.getElementById('entCusto');
      const calc = () => { document.getElementById('entTotal').textContent = R$((Number(qtd.value) || 0) * (Number(custo.value) || 0)); };
      sel.onchange = () => { custo.value = Number(produto(sel.value)?.custo || 0); calc(); };
      qtd.oninput = calc; custo.oninput = calc; calc();
    },
  });
}

async function salvarEntradaEstoque() {
  const f = formData();
  const p = produto(f.produtoId);
  const qtd = Number(f.quantidade);
  if (!p || !(qtd > 0)) return toast('Escolha o produto e informe uma quantidade maior que zero.');
  const unit = Number(f.valorUnit) || 0;
  const total = qtd * unit;
  try {
    let caixaId = null;
    if (f.lancarCaixa && total > 0) {
      const lanc = await inserir('caixa', {
        tipo: 'saida', descricao: `Compra de ${p.nome}${qtd > 1 ? ` (${qtd} ${p.unidade || 'un'})` : ''}`,
        categoria: 'Produtos', valor: total, data: f.data, pagamento: f.pagamento,
      });
      db.caixa.push(lanc);
      caixaId = lanc.id;
    }
    await registrarMov(p, 'entrada', qtd, qtd, {
      valorUnit: unit, total, motivo: f.motivo || 'Compra', data: f.data, caixaId,
      custo: unit > 0 ? unit : undefined, // guarda o custo mais recente
    });
    closeModal(); render();
    toast(`Entrada registrada — estoque: ${Number(p.estoque)} ${p.unidade || 'un'}`);
  } catch (e) { erroSync(e); }
}

// =====================================================================
// VENDA
// =====================================================================
function modalVendaProduto(id) {
  const disponiveis = produtosAtivos().filter((p) => Number(p.estoque) > 0 || Number(p.id) === Number(id));
  if (!disponiveis.length) return toast('Nenhum produto disponível em estoque.');
  const p = id ? produto(id) : disponiveis[0];
  const clis = [...db.clientes].sort((a, b) => a.nome.localeCompare(b.nome));
  openModal({
    title: 'Vender produto',
    body: `<div class="form-grid">
      ${field('Produto *', `<select name="produtoId" id="vdProduto">${opts(disponiveis, p?.id, (x) => `${x.nome} — ${R$(x.preco)} (${Number(x.estoque || 0)} ${x.unidade || 'un'})`)}</select>`, true)}
      ${field('Quantidade *', `<input type="number" step="1" min="1" name="quantidade" id="vdQtd" value="1"><span class="hint" id="vdDisp"></span>`)}
      ${field('Preço unitário (R$)', `<input type="number" step="0.01" min="0" name="valorUnit" id="vdPreco" value="${Number(p?.preco || 0)}">`)}
      ${field('Cliente', `<select name="clienteId"><option value="">Não informar</option>${opts(clis, '', (c) => c.nome)}</select>`)}
      ${field('Data *', `<input type="date" name="data" value="${hojeISO()}">`)}
      ${field('Forma de pagamento *', `<select name="pagamento">${Object.entries(PAGAMENTOS).map(([k, v]) => `<option value="${k}" ${k === 'pix' ? 'selected' : ''}>${v}</option>`).join('')}</select>`, true)}
      <div class="field full"><div class="total-box"><span>Total da venda</span><span class="v" id="vdTotal">R$ 0,00</span></div></div>
    </div>`,
    foot: `<button class="btn" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="salvarVendaProduto()">Vender e lançar no caixa</button>`,
    onOpen() {
      const sel = document.getElementById('vdProduto'), qtd = document.getElementById('vdQtd'), preco = document.getElementById('vdPreco');
      const calc = () => {
        const prod = produto(sel.value);
        document.getElementById('vdTotal').textContent = R$((Number(qtd.value) || 0) * (Number(preco.value) || 0));
        document.getElementById('vdDisp').textContent = prod ? `Disponível: ${Number(prod.estoque || 0)} ${prod.unidade || 'un'}` : '';
      };
      sel.onchange = () => { preco.value = Number(produto(sel.value)?.preco || 0); calc(); };
      qtd.oninput = calc; preco.oninput = calc; calc();
    },
  });
}

async function salvarVendaProduto() {
  const f = formData();
  const p = produto(f.produtoId);
  const qtd = Number(f.quantidade);
  if (!p || !(qtd > 0)) return toast('Escolha o produto e informe a quantidade.');
  if (qtd > Number(p.estoque || 0)) return toast(`Estoque insuficiente: restam ${Number(p.estoque || 0)} ${p.unidade || 'un'}.`);
  const unit = Number(f.valorUnit) || 0;
  const total = qtd * unit;
  const cli = f.clienteId ? cliente(f.clienteId) : null;
  try {
    const lanc = await inserir('caixa', {
      tipo: 'entrada',
      descricao: `${p.nome}${qtd > 1 ? ` x${qtd}` : ''}${cli ? ` — ${cli.nome}` : ''}`,
      categoria: 'Venda de produto', valor: total, data: f.data, pagamento: f.pagamento,
    });
    db.caixa.push(lanc);
    await registrarMov(p, 'venda', qtd, -qtd, {
      valorUnit: unit, total, data: f.data, caixaId: lanc.id,
      motivo: cli ? `Venda para ${cli.nome}` : 'Venda no balcão',
    });
    closeModal(); render();
    const restante = Number(p.estoque);
    toast(`Venda registrada · ${R$(total)}${restante <= Number(p.estoqueMin || 0) ? ' — estoque no mínimo!' : ''}`);
  } catch (e) { erroSync(e); }
}

// =====================================================================
// BAIXA / AJUSTE
// =====================================================================
function modalBaixaEstoque(id) {
  if (!desbloqueado()) return comSenha(() => modalBaixaEstoque(id), 'Dar baixa no estoque exige acesso gerencial.');
  if (!db.produtos.length) return toast('Cadastre um produto primeiro.');
  const p = id ? produto(id) : db.produtos[0];
  openModal({
    title: 'Baixa / ajuste de estoque',
    body: `<div class="form-grid">
      ${field('Produto *', `<select name="produtoId" id="bxProduto">${opts(db.produtos, p?.id, (x) => `${x.nome} — ${Number(x.estoque || 0)} ${x.unidade || 'un'}`)}</select>`, true)}
      ${field('Operação *', `<select name="operacao" id="bxOper">
        <option value="baixa">Baixa (retirar do estoque)</option>
        <option value="ajuste">Ajuste de inventário (informar contagem real)</option>
      </select>`, true)}
      ${field('<span id="bxLabel">Quantidade a retirar *</span>', `<input type="number" step="0.01" min="0" name="quantidade" id="bxQtd" value="1">`)}
      ${field('Data *', `<input type="date" name="data" value="${hojeISO()}">`)}
      ${field('Motivo', `<select name="motivo" id="bxMotivo">${MOTIVOS_BAIXA.map((m) => `<option>${m}</option>`).join('')}</select>`, true)}
      <div class="field full"><div class="total-box"><span>Estoque depois da operação</span><span class="v" id="bxResultado">—</span></div></div>
    </div>`,
    foot: `<button class="btn" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="salvarBaixaEstoque()">Confirmar</button>`,
    onOpen() {
      const sel = document.getElementById('bxProduto'), qtd = document.getElementById('bxQtd'), oper = document.getElementById('bxOper');
      const calc = () => {
        const prod = produto(sel.value);
        const atual = Number(prod?.estoque || 0), n = Number(qtd.value) || 0;
        const fim = oper.value === 'ajuste' ? n : atual - n;
        document.getElementById('bxLabel').textContent = oper.value === 'ajuste' ? 'Contagem real no armário *' : 'Quantidade a retirar *';
        document.getElementById('bxResultado').textContent = `${fim.toLocaleString('pt-BR')} ${prod?.unidade || 'un'}`;
        document.getElementById('bxResultado').style.color = fim < 0 ? 'var(--danger)' : '';
      };
      sel.onchange = calc; qtd.oninput = calc; oper.onchange = calc; calc();
    },
  });
}

async function salvarBaixaEstoque() {
  const f = formData();
  const p = produto(f.produtoId);
  const n = Number(f.quantidade);
  if (!p || isNaN(n) || n < 0) return toast('Escolha o produto e informe a quantidade.');
  const atual = Number(p.estoque || 0);
  const ajuste = f.operacao === 'ajuste';
  const delta = ajuste ? n - atual : -n;
  if (!ajuste && n > atual) return toast(`Não é possível retirar ${n}: o estoque atual é ${atual}.`);
  if (!ajuste && n === 0) return toast('Informe uma quantidade maior que zero.');
  try {
    await registrarMov(p, ajuste ? 'ajuste' : 'baixa', Math.abs(delta) || n, delta, {
      valorUnit: Number(p.custo || 0), total: Math.abs(delta) * Number(p.custo || 0), data: f.data,
      motivo: ajuste ? `Ajuste de inventário (${atual} → ${n})` : f.motivo,
    });
    closeModal(); render(); toast('Estoque atualizado');
  } catch (e) { erroSync(e); }
}

// =====================================================================
// EXPORTAR INVENTÁRIO
// =====================================================================
function exportarInventarioExcel() {
  if (!db.produtos.length) return toast('Nenhum produto cadastrado.');
  const inventario = [
    [B('SPARTA BARBEARIA — INVENTÁRIO DE PRODUTOS')],
    [T('Gerado em'), T(new Date().toLocaleString('pt-BR'))],
    [],
    [B('Produto'), B('Categoria'), B('Unidade'), B('Estoque'), B('Mínimo'), B('Custo'), B('Preço'), B('Total a custo'), B('Total a venda'), B('Status')],
    ...[...db.produtos].sort((a, b) => a.nome.localeCompare(b.nome)).map((p) => [
      T(p.nome), T(p.categoria || ''), T(p.unidade || 'un'),
      N(p.estoque), N(p.estoqueMin), M(p.custo), M(p.preco),
      M(Number(p.estoque || 0) * Number(p.custo || 0)),
      M(Number(p.estoque || 0) * Number(p.preco || 0)),
      T(p.ativo !== false ? 'Ativo' : 'Inativo'),
    ]),
    [B('TOTAL'), T(''), T(''), T(''), T(''), T(''), T(''), BM(valorEstoque('custo')), BM(valorEstoque('preco')), T('')],
  ];
  const movimentacoes = [
    [B('Data'), B('Produto'), B('Tipo'), B('Quantidade'), B('Saldo'), B('Valor unit.'), B('Total'), B('Motivo'), B('Registrado por')],
    ...[...db.estoqueMov].sort((a, b) => String(a.data).localeCompare(String(b.data)) || a.id - b.id).map((m) => [
      T(fmtData(m.data)), T(m.produtoNome || produto(m.produtoId)?.nome || ''), T(TIPOS_MOV[m.tipo] || m.tipo),
      N(m.quantidade), N(m.saldo), M(m.valorUnit), M(m.total), T(m.motivo || ''), T(m.usuarioNome || ''),
    ]),
  ];
  xlsxBaixar(`inventario-sparta-${hojeISO()}.xlsx`, [
    { nome: 'Inventário', linhas: inventario },
    { nome: 'Movimentações', linhas: movimentacoes },
  ]);
  toast('Planilha gerada');
}


// =====================================================================
// CONTAGEM DE ESTOQUE (inventário às cegas + aprovação da gerência)
// Quem conta digita o que achou na prateleira sem ver o saldo do sistema.
// A contagem NÃO mexe no estoque: fica pendente até a gerência decidir,
// item a item, se aceita o número ou manda recontar.
// =====================================================================
const contagensPendentes = () => (db.contagens || []).filter((c) => c.status === 'pendente');
const recontagensAbertas = () => (db.contagens || []).filter((c) => c.status === 'recontagem');
const itensParaRecontar = () => {
  const ids = new Set();
  recontagensAbertas().forEach((c) => (c.itens || []).forEach((i) => { if (i.decisao === 'recontar') ids.add(Number(i.produtoId)); }));
  return ids;
};

function modalContagem(soRecontar = false) {
  if (db.contagensOk === false) return toast('Rode o arquivo contagens.sql no Supabase para habilitar a contagem.');
  const pedidos = itensParaRecontar();
  let lista = produtosAtivos().sort((a, b) => a.nome.localeCompare(b.nome));
  if (soRecontar && pedidos.size) lista = lista.filter((p) => pedidos.has(Number(p.id)));
  if (!lista.length) return toast('Nenhum produto ativo para contar.');
  // pedidos de recontagem aparecem primeiro
  lista.sort((a, b) => (pedidos.has(Number(b.id)) ? 1 : 0) - (pedidos.has(Number(a.id)) ? 1 : 0));

  openModal({
    largo: true,
    title: soRecontar ? 'Recontagem solicitada' : 'Contagem de estoque',
    body: `<div class="form-grid">
      ${field('Data da contagem *', `<input type="date" name="data" value="${hojeISO()}">`)}
      ${field('Responsável', `<input value="${esc(nomeUsuarioAtual())}" disabled>`)}
      <div class="field full">
        <label>Quantidade contada</label>
        <span class="hint">Conte o que existe hoje na prateleira e anote aqui. Deixe em branco o que você não contou.${desbloqueado() ? '' : ' A gerência confere antes de o saldo mudar.'}</span>
      </div>
      <div class="field full"><div class="table-wrap"><table>
        <thead><tr><th>Produto</th><th>Unidade</th><th class="num" style="width:130px">Contagem</th></tr></thead>
        <tbody>
          ${lista.map((p) => `<tr>
            <td class="strong">${esc(p.nome)} ${pedidos.has(Number(p.id)) ? '<span class="badge badge-confirmado">recontar</span>' : ''}</td>
            <td class="muted">${esc(p.unidade || 'un')}</td>
            <td class="num"><input type="number" min="0" step="0.01" class="contagemItem" data-id="${p.id}" placeholder="—" style="width:110px;text-align:right"></td>
          </tr>`).join('')}
        </tbody>
      </table></div></div>
      ${field('Observação', `<input name="obs" placeholder="Ex.: conferência do fim do mês">`, true)}
    </div>`,
    foot: `<button class="btn" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="salvarContagem()">Enviar contagem</button>`,
  });
}

async function salvarContagem() {
  const f = formData();
  const campos = [...modalEl.querySelectorAll('.contagemItem')].filter((i) => i.value !== '');
  if (!campos.length) return toast('Informe a contagem de pelo menos um produto.');

  const itens = campos.map((i) => {
    const p = produto(i.dataset.id);
    const contagem = Number(i.value);
    const esperado = Number(p?.estoque || 0);
    return { produtoId: Number(p.id), nome: p.nome, unidade: p.unidade || 'un', esperado, contagem, diferenca: contagem - esperado, decisao: 'pendente' };
  }).filter((x) => x.produtoId && !isNaN(x.contagem) && x.contagem >= 0);

  try {
    const nova = await inserir('contagens', {
      data: f.data || hojeISO(),
      usuarioNome: nomeUsuarioAtual(),
      perfil: desbloqueado() ? 'gerencia' : 'barbeiro',
      status: 'pendente',
      obs: f.obs || '',
      itens,
    });
    db.contagens.push(nova);

    // A contagem anterior que pedia recontagem desses itens é encerrada
    for (const c of recontagensAbertas()) {
      const cobertos = (c.itens || []).filter((i) => i.decisao === 'recontar').every((i) => itens.some((n) => Number(n.produtoId) === Number(i.produtoId)));
      if (cobertos) {
        c.status = 'concluida';
        await atualizar('contagens', c.id, { status: 'concluida' });
      }
    }

    closeModal(); render();
    if (desbloqueado()) return modalRevisarContagem(nova.id);
    openModal({
      title: 'Contagem enviada',
      body: `<div class="modal-msg">Obrigado! A contagem de <strong>${itens.length} produto(s)</strong> foi enviada para a gerência conferir.<br><br>O estoque só muda depois que a gerência aprovar.</div>`,
      foot: `<button class="btn btn-primary" onclick="closeModal()">Fechar</button>`,
    });
  } catch (err) { erroSync(err); }
}

// ---------------------------------------------------------------------
// REVISÃO DA GERÊNCIA
// ---------------------------------------------------------------------
function modalRevisarContagem(id) {
  if (!desbloqueado()) return comSenha(() => modalRevisarContagem(id), 'Aprovar contagens exige acesso gerencial.');
  const c = byId(db.contagens, id);
  if (!c) return toast('Contagem não encontrada.');
  const itens = c.itens || [];
  const divergentes = itens.filter((i) => Number(i.diferenca) !== 0);

  openModal({
    largo: true,
    title: 'Conferir contagem',
    body: `<p class="modal-msg" style="margin-bottom:14px">
        Contagem de <strong>${fmtData(c.data)}</strong> feita por <strong>${esc(c.usuarioNome || '—')}</strong>${c.obs ? ` · ${esc(c.obs)}` : ''}.<br>
        ${divergentes.length
          ? `<strong>${divergentes.length} divergência(s)</strong> em ${itens.length} produto(s) contado(s). Escolha o que fazer com cada uma.`
          : `Todos os ${itens.length} produto(s) conferem com o sistema. Nada a corrigir.`}
      </p>
      <div class="table-wrap"><table>
        <thead><tr><th>Produto</th><th class="num">Sistema</th><th class="num">Contado</th><th class="num">Diferença</th><th class="num">Valor</th><th style="width:170px">Decisão</th></tr></thead>
        <tbody>
        ${itens.map((i, idx) => {
          const p = produto(i.produtoId);
          const dif = Number(i.diferenca);
          const mudou = p && Number(p.estoque) !== Number(i.esperado);
          return `<tr>
            <td class="strong">${esc(i.nome)}${mudou ? `<div class="muted" style="font-size:12px">saldo mudou desde a contagem (agora ${Number(p.estoque)})</div>` : ''}</td>
            <td class="num muted">${Number(i.esperado)}</td>
            <td class="num">${Number(i.contagem)}</td>
            <td class="num strong" style="color:${dif === 0 ? 'var(--ok)' : dif < 0 ? 'var(--danger)' : 'var(--warn)'}">${dif === 0 ? 'confere' : (dif > 0 ? '+' : '') + dif}</td>
            <td class="num">${dif === 0 ? '—' : R$(Math.abs(dif) * Number(p?.custo || 0))}</td>
            <td>${dif === 0
              ? '<span class="badge badge-ativo">OK</span>'
              : `<select class="decisaoItem" data-idx="${idx}">
                   <option value="aceitar">Aceitar contagem</option>
                   <option value="recontar">Pedir recontagem</option>
                   <option value="ignorar">Manter o sistema</option>
                 </select>`}</td>
          </tr>`;
        }).join('')}
        </tbody>
      </table></div>`,
    foot: `<button class="btn" onclick="closeModal()">Decidir depois</button>
           ${divergentes.length ? `<button class="btn" onclick="decidirTudo('recontar')">Mandar recontar tudo</button>
           <button class="btn" onclick="decidirTudo('aceitar')">Aceitar tudo</button>` : ''}
           <button class="btn btn-primary" onclick="aplicarRevisao(${c.id})">Confirmar</button>`,
  });
}

function decidirTudo(valor) {
  modalEl.querySelectorAll('.decisaoItem').forEach((s) => (s.value = valor));
  toast(valor === 'aceitar' ? 'Todas as divergências marcadas para aceitar' : 'Todas marcadas para recontagem');
}

async function aplicarRevisao(id) {
  const c = byId(db.contagens, id);
  if (!c) return;
  const decisoes = {};
  modalEl.querySelectorAll('.decisaoItem').forEach((s) => (decisoes[s.dataset.idx] = s.value));

  const itens = (c.itens || []).map((i, idx) => ({ ...i, decisao: Number(i.diferenca) === 0 ? 'confere' : (decisoes[idx] || 'ignorar') }));
  const aceitos = itens.filter((i) => i.decisao === 'aceitar');
  const recontar = itens.filter((i) => i.decisao === 'recontar');

  try {
    for (const i of aceitos) {
      const p = produto(i.produtoId);
      if (!p) continue;
      // aplica a DIFERENÇA sobre o saldo atual — assim vendas feitas
      // entre a contagem e a aprovação não são perdidas
      const delta = Number(i.diferenca);
      if (!delta) continue;
      await registrarMov(p, 'ajuste', Math.abs(delta), delta, {
        valorUnit: Number(p.custo || 0), total: Math.abs(delta) * Number(p.custo || 0), data: c.data,
        motivo: `Contagem de ${c.usuarioNome || '—'} aprovada por ${nomeUsuarioAtual()} (${i.esperado} → ${i.contagem})`,
      });
    }
    const status = recontar.length ? 'recontagem' : 'concluida';
    const patch = { itens, status, revisadoPor: nomeUsuarioAtual(), revisadoEm: new Date().toISOString() };
    Object.assign(c, patch);
    await atualizar('contagens', c.id, patch);

    closeModal(); render();
    toast(recontar.length
      ? `${aceitos.length} ajuste(s) aplicado(s) · ${recontar.length} item(ns) enviado(s) para recontagem`
      : `Contagem conferida — ${aceitos.length} ajuste(s) aplicado(s)`);
  } catch (err) { erroSync(err); }
}

// =====================================================================
// EXTRATO DE MOVIMENTAÇÕES
// Entradas, saídas, contagens e a comparação entre saldo esperado,
// saldo previsto (sistema) e saldo real (última contagem aprovada).
// =====================================================================
function ultimaContagemDe(produtoId) {
  let achada = null;
  (db.contagens || []).forEach((c) => {
    (c.itens || []).forEach((i) => {
      if (Number(i.produtoId) !== Number(produtoId)) return;
      if (!achada || String(c.data) >= String(achada.data)) achada = { data: c.data, contagem: Number(i.contagem), status: c.status, decisao: i.decisao, quem: c.usuarioNome };
    });
  });
  return achada;
}

function dadosExtrato() {
  const grupos = new Map();
  db.produtos.forEach((p) => grupos.set(Number(p.id), { produto: p, movs: [], linhas: [], entradas: 0, saidas: 0, esperado: 0 }));

  [...db.estoqueMov]
    .sort((a, b) => String(a.data).localeCompare(String(b.data)) || a.id - b.id)
    .forEach((m) => { const g = grupos.get(Number(m.produtoId)); if (g) g.movs.push(m); });

  grupos.forEach((g) => {
    // 1ª passada: quanto entrou e quanto saiu
    let ref = 0;
    const passos = g.movs.map((m) => {
      const q = Number(m.quantidade) || 0;
      let entrada = 0, saida = 0;
      if (m.tipo === 'entrada') entrada = q;
      else if (m.tipo === 'venda' || m.tipo === 'baixa') saida = q;
      else if (m.tipo === 'ajuste') { const delta = Number(m.saldo) - ref; if (delta >= 0) entrada = delta; else saida = -delta; }
      ref += entrada - saida;
      g.entradas += entrada; g.saidas += saida;
      return { mov: m, entrada, saida };
    });

    // Saldo de abertura: o que já existia antes da primeira movimentação
    const previsto = Number(g.produto.estoque || 0);
    g.inicial = previsto - (g.entradas - g.saidas);
    g.esperado = g.inicial;
    if (Math.abs(g.inicial) > 0.001) {
      g.linhas.push({ abertura: true, data: g.produto.criadoEm ? String(g.produto.criadoEm).slice(0, 10) : '',
        entrada: g.inicial, saida: 0, esperado: g.inicial, registrado: g.inicial, ok: true });
    }

    // 2ª passada: extrato linha a linha, partindo do saldo de abertura
    passos.forEach(({ mov, entrada, saida }) => {
      g.esperado += entrada - saida;
      const registrado = Number(mov.saldo ?? g.esperado);
      g.linhas.push({ mov, entrada, saida, esperado: g.esperado, registrado, ok: Math.abs(registrado - g.esperado) < 0.001 });
    });
  });

  const resumo = [...grupos.values()].map((g) => {
    const previsto = Number(g.produto.estoque || 0);
    const cont = ultimaContagemDe(g.produto.id);
    const real = cont ? cont.contagem : null;
    const conferido = real !== null && Math.abs(previsto - real) < 0.001;
    const historicoOk = g.linhas.every((l) => l.ok);
    return { ...g, previsto, real, contagem: cont, conferido, historicoOk,
      situacao: real === null ? 'Sem contagem' : conferido ? 'OK' : 'ALERTA' };
  }).sort((a, b) => a.produto.nome.localeCompare(b.produto.nome));

  return { grupos, resumo };
}

function exportarExtratoExcel() {
  if (!db.produtos.length) return toast('Nenhum produto cadastrado.');
  const { resumo } = dadosExtrato();

  const abaResumo = [
    [B('SPARTA BARBEARIA — EXTRATO DE ESTOQUE')],
    [T('Gerado em'), T(new Date().toLocaleString('pt-BR'))],
    [],
    [B('Produto'), B('Saldo inicial'), B('Entradas'), B('Saídas'), B('Saldo esperado'), B('Saldo previsto'), B('Saldo real'), B('Diferença'), B('Situação'), B('Última contagem')],
    ...resumo.map((g) => [
      T(g.produto.nome), N(g.inicial), N(g.entradas), N(g.saidas), N(g.esperado), N(g.previsto),
      g.real === null ? T('—') : N(g.real),
      g.real === null ? T('—') : N(g.previsto - g.real),
      T(g.situacao === 'OK' ? 'OK' : g.situacao === 'ALERTA' ? '⚠ ALERTA' : '—'),
      T(g.contagem ? `${fmtData(g.contagem.data)} · ${g.contagem.quem || ''}` : 'nunca contado'),
    ]),
    [B('TOTAL'), N(resumo.reduce((s, g) => s + g.inicial, 0)), N(resumo.reduce((s, g) => s + g.entradas, 0)), N(resumo.reduce((s, g) => s + g.saidas, 0)),
     N(resumo.reduce((s, g) => s + g.esperado, 0)), N(resumo.reduce((s, g) => s + g.previsto, 0)), T(''), T(''),
     T(resumo.some((g) => g.situacao === 'ALERTA') ? '⚠ verificar' : 'OK'), T('')],
  ];

  const abaExtrato = [
    [B('Data'), B('Produto'), B('Movimentação'), B('Entrada'), B('Saída'), B('Saldo esperado'), B('Saldo registrado'), B('Situação'), B('Motivo'), B('Responsável')],
  ];
  resumo.forEach((g) => {
    g.linhas.forEach((l) => abaExtrato.push(l.abertura ? [
      T(l.data ? fmtData(l.data) : '—'), T(g.produto.nome), T('Saldo inicial'),
      N(l.entrada), T(''), N(l.esperado), N(l.registrado), T('OK'), T('Saldo já existente no cadastro'), T(''),
    ] : [
      T(fmtData(l.mov.data)), T(g.produto.nome), T(TIPOS_MOV[l.mov.tipo] || l.mov.tipo),
      l.entrada ? N(l.entrada) : T(''), l.saida ? N(l.saida) : T(''),
      N(l.esperado), N(l.registrado), T(l.ok ? 'OK' : '⚠ ALERTA'),
      T(l.mov.motivo || ''), T(l.mov.usuarioNome || ''),
    ]));
    abaExtrato.push([
      B('Fechamento'), B(g.produto.nome), T(''), N(g.entradas), N(g.saidas), N(g.esperado), N(g.previsto),
      T(g.situacao === 'OK' ? 'OK' : g.situacao === 'ALERTA' ? '⚠ ALERTA' : '—'),
      T(g.real === null ? 'sem contagem' : `saldo real contado: ${g.real}`), T(''),
    ]);
    abaExtrato.push([]);
  });

  const abaContagens = [
    [B('Data'), B('Responsável'), B('Perfil'), B('Status'), B('Produto'), B('Sistema'), B('Contado'), B('Diferença'), B('Decisão')],
    ...(db.contagens || []).flatMap((c) => (c.itens || []).map((i) => [
      T(fmtData(c.data)), T(c.usuarioNome || ''), T(c.perfil || ''), T(c.status || ''),
      T(i.nome), N(i.esperado), N(i.contagem), N(i.diferenca),
      T({ aceitar: 'Aceita', recontar: 'Recontagem pedida', ignorar: 'Mantido o sistema', confere: 'Conferiu', pendente: 'Aguardando gerência' }[i.decisao] || i.decisao || ''),
    ])),
  ];

  xlsxBaixar(`extrato-estoque-sparta-${hojeISO()}.xlsx`, [
    { nome: 'Resumo', linhas: abaResumo },
    { nome: 'Extrato', linhas: abaExtrato },
    { nome: 'Contagens', linhas: abaContagens },
  ]);
  toast('Extrato gerado');
}
