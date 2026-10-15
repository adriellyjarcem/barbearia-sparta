/* =====================================================================
   BARBEARIA — GESTÃO  |  app.js  (versão Supabase + Multi-Gerência)
   Persistência: Supabase (Postgres) — dados na nuvem, multi-dispositivo
   ===================================================================== */

// ---------- BANCO DE DADOS (cache em memória) ----------
let db = null;

// Gera um ID local temporário para novos registros antes do insert.
// O ID definitivo vem do banco (identity).
let _tmpId = 0;
function tmpId() { return --_tmpId; }

// ---------- CARREGAR / SEED ----------
async function carregarDados() {
  try {
    const [sv, cl, ag, at, cx, cb, bb, cf, gr] = await Promise.all([
      supabaseClient.from('servicos').select('*').order('id'),
      supabaseClient.from('clientes').select('*').order('id'),
      supabaseClient.from('agendamentos').select('*').order('id'),
      supabaseClient.from('atendimentos').select('*').order('id'),
      supabaseClient.from('caixa').select('*').order('id'),
      supabaseClient.from('combos').select('*').order('id'),
      supabaseClient.from('barbeiros').select('*').order('id'),
      supabaseClient.from('config').select('*').limit(1),
      supabaseClient.from('usuarios_gerencia').select('*').order('id'),
    ]);

    const erro = [sv, cl, ag, at, cx, cb, bb, cf, gr].find(r => r.error);
    if (erro) throw erro.error;

    db = {
      servicos: sv.data || [],
      clientes: cl.data || [],
      agendamentos: ag.data || [],
      atendimentos: at.data || [],
      caixa: cx.data || [],
      combos: cb.data || [],
      barbeiros: bb.data || [],
      config: (cf.data && cf.data[0]) || { id: 1, senhaHash: null },
      gerencia: gr.data || [],
      ...(await carregarEstoque()),
      atendItensOk: await checarItensAtendimento(),
    };

    // Primeira execução: banco vazio → insere dados de teste
    if (!db.servicos.length && !db.clientes.length) {
      await seed();
      await recarregar();
    }
    return db;
  } catch (e) {
    console.error('Erro ao carregar dados do Supabase', e);
    document.getElementById('content').innerHTML =
      `<div class="panel"><div class="empty" style="padding:48px">
        <div style="font-size:40px;margin-bottom:8px">⚠️</div>
        <p>Não foi possível conectar ao Supabase.</p>
        <p class="muted">Verifique SUPABASE_URL e SUPABASE_ANON_KEY no arquivo supabase.js
        e se as tabelas foram criadas.</p>
      </div></div>`;
    throw e;
  }
}

// Carrega estoque separado: se as tabelas ainda não existirem no Supabase,
// o resto do sistema continua funcionando normalmente.
// Verifica se a tabela atendimentos já tem as colunas de múltiplos itens.
async function checarItensAtendimento() {
  const { error } = await supabaseClient.from('atendimentos').select('id, itens').limit(1);
  if (error) {
    console.warn('Colunas de itens ausentes — rode atendimento-itens.sql no Supabase.', error);
    return false;
  }
  return true;
}

async function carregarEstoque() {
  try {
    const [pr, mv] = await Promise.all([
      supabaseClient.from('produtos').select('*').order('id'),
      supabaseClient.from('estoque_mov').select('*').order('id'),
    ]);
    if (pr.error || mv.error) throw (pr.error || mv.error);

    // Consulta separada: se a tabela de contagens ainda não existir,
    // o estoque continua funcionando normalmente (só sem conferência).
    let contagens = [], contagensOk = true;
    try {
      const ct = await supabaseClient.from('contagens').select('*').order('id');
      if (ct.error) throw ct.error;
      contagens = ct.data || [];
    } catch (err) {
      contagensOk = false;
      console.warn('Tabela contagens ausente — rode contagens.sql no Supabase.', err);
    }
    return { produtos: pr.data || [], estoqueMov: mv.data || [], estoqueOk: true, contagens, contagensOk };
  } catch (e) {
    console.warn('Tabelas de estoque não encontradas — rode o arquivo estoque.sql no Supabase.', e);
    return { produtos: [], estoqueMov: [], estoqueOk: false, contagens: [], contagensOk: false };
  }
}

async function recarregar() {
  const [sv, cl, ag, at, cx, cb, bb, cf, gr] = await Promise.all([
    supabaseClient.from('servicos').select('*').order('id'),
    supabaseClient.from('clientes').select('*').order('id'),
    supabaseClient.from('agendamentos').select('*').order('id'),
    supabaseClient.from('atendimentos').select('*').order('id'),
    supabaseClient.from('caixa').select('*').order('id'),
    supabaseClient.from('combos').select('*').order('id'),
    supabaseClient.from('barbeiros').select('*').order('id'),
    supabaseClient.from('config').select('*').limit(1),
    supabaseClient.from('usuarios_gerencia').select('*').order('id'),
  ]);
  db = {
    servicos: sv.data || [],
    clientes: cl.data || [],
    agendamentos: ag.data || [],
    atendimentos: at.data || [],
    caixa: cx.data || [],
    combos: cb.data || [],
    barbeiros: bb.data || [],
    config: (cf.data && cf.data[0]) || { id: 1, senhaHash: null },
    gerencia: gr.data || [],
    ...(await carregarEstoque()),
    atendItensOk: await checarItensAtendimento(),
  };
}

// ---------- HELPERS DE PERSISTÊNCIA ----------
async function inserir(tabela, registro) {
  const { id, ...resto } = registro;
  const { data, error } = await supabaseClient.from(tabela).insert([resto]).select().single();
  if (error) throw error;
  return data;
}
async function atualizar(tabela, id, registro) {
  const { id: _ign, ...resto } = registro;
  const { error } = await supabaseClient.from(tabela).update(resto).eq('id', id);
  if (error) throw error;
}
async function remover(tabela, id) {
  const { error } = await supabaseClient.from(tabela).delete().eq('id', id);
  if (error) throw error;
}
async function removerOnde(tabela, coluna, valor) {
  const { error } = await supabaseClient.from(tabela).delete().eq(coluna, valor);
  if (error) throw error;
}
async function salvarConfig() {
  await supabaseClient.from('config').upsert({ id: 1, senhaHash: db.config.senhaHash });
}

function erroSync(e) {
  console.error(e);
  toast('Erro ao salvar na nuvem: ' + (e.message || 'verifique a conexão'));
}

// ---------- DADOS DE TESTE (primeira execução) ----------
async function seed() {
  const hoje = new Date();
  const dia = (n) => fmtISO(addDays(hoje, n));

  // Serviços
  const corte = await inserir('servicos', { nome: 'Corte', categoria: 'Cabelo', duracao: 30, valor: 40, ativo: true });
  const barba = await inserir('servicos', { nome: 'Barba', categoria: 'Barba', duracao: 20, valor: 30, ativo: true });
  await inserir('servicos', { nome: 'Sobrancelha', categoria: 'Estética', duracao: 10, valor: 15, ativo: true });
  const pig = await inserir('servicos', { nome: 'Pigmentação de barba', categoria: 'Barba', duracao: 25, valor: 35, ativo: true });

  // Clientes
  const joao = await inserir('clientes', { nome: 'João Silva', telefone: '(67) 99911-1111', obs: 'Prefere máquina 2 nas laterais', criadoEm: Date.now() });
  const pedro = await inserir('clientes', { nome: 'Pedro Santos', telefone: '(67) 99922-2222', obs: '', criadoEm: Date.now() });
  const lucas = await inserir('clientes', { nome: 'Lucas Oliveira', telefone: '(67) 99933-3333', obs: 'Cliente desde 2022', criadoEm: Date.now() });

  // Barbeiro de teste — login: Carlos / senha: 1234
  const carlos = await inserir('barbeiros', { nome: 'Carlos', telefone: '(67) 99900-0000', comissao: 40, senhaHash: hashSenha('1234'), ativo: true });

  // Gerente padrão — login: Administrador / senha: admin
  await inserir('usuarios_gerencia', { nome: 'Administrador', senhaHash: hashSenha('admin'), ativo: true });

  // Combo
  await inserir('combos', { nome: 'Corte + Barba', servicoIds: [corte.id, barba.id], valor: 60, ativo: true });

  // Agendamentos
  await inserir('agendamentos', { clienteId: joao.id, servicoId: corte.id, tipo: 'servico', barbeiroId: carlos.id, data: dia(0), hora: '15:00', status: 'confirmado', obs: '' });
  await inserir('agendamentos', { clienteId: pedro.id, servicoId: barba.id, tipo: 'servico', barbeiroId: carlos.id, data: dia(1), hora: '10:30', status: 'agendado', obs: 'Ligar antes' });
  await inserir('agendamentos', { clienteId: lucas.id, servicoId: corte.id, tipo: 'servico', barbeiroId: carlos.id, data: dia(2), hora: '14:00', status: 'agendado', obs: '' });

  // Atendimentos + caixa
  const at = async (cliente, servico, data, hora, desconto, pagamento) => {
    const valorFinal = servico.valor - desconto;
    const a = await inserir('atendimentos', {
      clienteId: cliente.id, clienteNome: cliente.nome, servicoId: servico.id, tipo: 'servico',
      descricao: servico.nome, barbeiroId: carlos.id, barbeiroNome: carlos.nome,
      data, hora, valor: servico.valor, desconto, valorFinal, pagamento,
    });
    await inserir('caixa', { tipo: 'entrada', descricao: `${servico.nome} — ${cliente.nome}`, categoria: 'Atendimento', valor: valorFinal, data, pagamento, atendimentoId: a.id });
  };
  await at(joao, corte, dia(0), '09:30', 0, 'pix');
  await at(pedro, barba, dia(-1), '16:00', 5, 'dinheiro');
  await at(lucas, pig, dia(-3), '11:00', 0, 'credito');

  // Produtos de exemplo (só se as tabelas de estoque existirem)
  try {
    await inserir('produtos', { nome: 'Pomada modeladora 120g', categoria: 'Pomada / Gel', unidade: 'un', custo: 18, preco: 35, estoque: 12, estoqueMin: 4, ativo: true });
    await inserir('produtos', { nome: 'Óleo para barba 30ml', categoria: 'Barba', unidade: 'un', custo: 14, preco: 30, estoque: 3, estoqueMin: 4, ativo: true });
    await inserir('produtos', { nome: 'Lâmina descartável', categoria: 'Lâminas / Descartáveis', unidade: 'cx', custo: 22, preco: 0, estoque: 6, estoqueMin: 2, ativo: true });
  } catch (e) {
    console.warn('Produtos de teste não criados (tabelas de estoque ausentes).', e);
  }

  await salvarConfig();
}

// ---------- UTILITÁRIOS ----------
const PAGAMENTOS = { dinheiro: 'Dinheiro', pix: 'Pix', debito: 'Débito', credito: 'Crédito' };
const STATUS = { agendado: 'Agendado', confirmado: 'Confirmado', concluido: 'Concluído', cancelado: 'Cancelado' };
const CAT_DESPESA = ['Produtos', 'Aluguel', 'Energia/Água', 'Equipamentos', 'Salário', 'Marketing', 'Outros'];
const R$ = (v) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pad = (n) => String(n).padStart(2, '0');
function fmtISO(dt) { return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`; }
function addDays(dt, n) { const d = new Date(dt); d.setDate(d.getDate() + n); return d; }
function fmtData(iso) { if (!iso) return '—'; const [y, m, d] = String(iso).slice(0,10).split('-'); return `${d}/${m}/${y}`; }
function fmtDataExt(iso) { const [y, m, d] = String(iso).slice(0,10).split('-'); const dt = new Date(y, m - 1, d); return dt.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' }); }
function hojeISO() { return fmtISO(new Date()); }
function mesAtual() { return hojeISO().slice(0, 7); }
function horaAgora() { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

const byId = (arr, id) => arr.find((x) => Number(x.id) === Number(id));
const cliente = (id) => byId(db.clientes, id);
const servico = (id) => byId(db.servicos, id);
const combo = (id) => byId(db.combos, id);
const barbeiro = (id) => byId(db.barbeiros, id);
const gerente = (id) => byId(db.gerencia, id);
const nomeBarbeiro = (a) => barbeiro(a.barbeiroId)?.nome || a.barbeiroNome || '—';
const nomeCliente = (a) => cliente(a.clienteId)?.nome || a.clienteNome || 'Cliente removido';

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(t._t); t._t = setTimeout(() => (t.hidden = true), 2500);
}

// ---------- MODAL ----------
const modalEl = document.getElementById('modal');
function openModal({ title, body, foot, onOpen, largo }) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = body;
  document.getElementById('modalFoot').innerHTML = foot || `<button class="btn" onclick="closeModal()">Cancelar</button>`;
  modalEl.querySelector('.modal').classList.toggle('largo', !!largo);
  modalEl.hidden = false;
  onOpen && onOpen();
  // Foca o primeiro campo, mas nunca um que esteja dentro de tabela:
  // isso rolaria a tabela para o lado e esconderia as primeiras colunas.
  const first = [...modalEl.querySelectorAll('.modal-body input:not([disabled]), .modal-body select, .modal-body textarea')]
    .find((el) => !el.closest('.table-wrap'));
  first && first.focus();
}
function closeModal() { modalEl.hidden = true; }
document.getElementById('modalClose').onclick = closeModal;
modalEl.addEventListener('click', (e) => { if (e.target === modalEl) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

function confirmar(msg, onYes, { danger = true, okLabel = 'Confirmar' } = {}) {
  openModal({
    title: 'Confirmação',
    body: `<div class="modal-msg">${msg}</div>`,
    foot: `<button class="btn" onclick="closeModal()">Cancelar</button> <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="confirmYes">${okLabel}</button>`,
    onOpen: () => { document.getElementById('confirmYes').onclick = () => { closeModal(); onYes(); }; },
  });
}

function formData() {
  const out = {};
  modalEl.querySelectorAll('[name]').forEach((el) => { out[el.name] = el.type === 'checkbox' ? el.checked : el.value.trim(); });
  return out;
}
const field = (label, inner, full = false) => `<div class="field ${full ? 'full' : ''}"><label>${label}</label>${inner}</div>`;
const opts = (list, sel, fn) => list.map((x) => `<option value="${x.id}" ${Number(sel) === Number(x.id) ? 'selected' : ''}>${esc(fn(x))}</option>`).join('');

// ---------- CÁLCULOS ----------
function statsCliente(id) {
  const ats = db.atendimentos.filter((a) => Number(a.clienteId) === Number(id));
  const ultimo = ats.map((a) => a.data + ' ' + a.hora).sort().pop();
  return { qtd: ats.length, ultimo: ultimo ? String(ultimo).slice(0, 10) : null, total: ats.reduce((s, a) => s + Number(a.valorFinal), 0) };
}
function resumoCaixa(filtro = () => true) {
  const lanc = db.caixa.filter(filtro);
  const r = { entradas: 0, saidas: 0, saldo: 0, dinheiro: 0, pix: 0, debito: 0, credito: 0 };
  lanc.forEach((l) => {
    const sinal = l.tipo === 'entrada' ? 1 : -1;
    const pg = PAGAMENTOS[l.pagamento] ? l.pagamento : 'dinheiro';
    const v = Number(l.valor);
    if (l.tipo === 'entrada') r.entradas += v; else r.saidas += v;
    r[pg] += sinal * v;
  });
  r.saldo = r.entradas - r.saidas;
  return r;
}
function faturamento(filtro) { return db.atendimentos.filter(filtro).reduce((s, a) => s + Number(a.valorFinal), 0); }

// =====================================================================
// SEGURANÇA — MULTI-GERÊNCIA
// =====================================================================
const PERFIL_KEY = 'barbearia_perfil';
const TELAS_BARBEIRO = ['agendamentos', 'atendimentos', 'clientes', 'servicos', 'combos', 'estoque'];
let perfil = sessionStorage.getItem(PERFIL_KEY) || null;
let barbeiroAtualId = Number(sessionStorage.getItem(PERFIL_KEY + '_barbeiro')) || null;
let gerenteAtualId = Number(sessionStorage.getItem(PERFIL_KEY + '_gerente')) || null;

const telaInicial = () => (perfil === 'gerencia' ? 'dashboard' : 'agendamentos');
const desbloqueado = () => perfil === 'gerencia';
const telaPermitida = (v) => perfil === 'gerencia' || TELAS_BARBEIRO.includes(v);

function entrarComo(p, usuarioId = null) {
  perfil = p;
  if (p === 'gerencia') {
    gerenteAtualId = usuarioId;
    barbeiroAtualId = null;
    sessionStorage.setItem(PERFIL_KEY + '_gerente', usuarioId);
    sessionStorage.removeItem(PERFIL_KEY + '_barbeiro');
  } else {
    barbeiroAtualId = usuarioId;
    gerenteAtualId = null;
    sessionStorage.setItem(PERFIL_KEY + '_barbeiro', usuarioId);
    sessionStorage.removeItem(PERFIL_KEY + '_gerente');
  }
  sessionStorage.setItem(PERFIL_KEY, p);
  aplicarPerfil();
  navigate(telaPermitida(viewAtual) ? viewAtual : telaInicial());
  
  const nome = p === 'gerencia' 
    ? (gerente(usuarioId)?.nome || 'Gerência') 
    : (barbeiro(usuarioId)?.nome || 'barbeiro');
  toast(`Bem-vindo, ${nome}`);
}

function sair() { 
  perfil = null; 
  barbeiroAtualId = null; 
  gerenteAtualId = null;
  sessionStorage.removeItem(PERFIL_KEY); 
  sessionStorage.removeItem(PERFIL_KEY + '_barbeiro'); 
  sessionStorage.removeItem(PERFIL_KEY + '_gerente');
  closeModal(); 
  aplicarPerfil(); 
}

function loginBarbeiro() {
  const ativos = db.barbeiros.filter((b) => b.ativo !== false);
  if (!ativos.length) return openModal({ title: 'Nenhum barbeiro cadastrado', body: `<div class="modal-msg">Peça à gerência para cadastrar os barbeiros na aba <strong>Barbeiros</strong>.</div>`, foot: `<button class="btn" onclick="closeModal()">Fechar</button>` });
  openModal({
    title: 'Entrar como barbeiro',
    body: `<div class="form-grid">
      ${field('Barbeiro', `<select name="barbeiroId">${ativos.map((b) => `<option value="${b.id}">${esc(b.nome)}</option>`).join('')}</select>`, true)}
      ${field('Senha', `<input type="password" name="senha" autocomplete="current-password">`, true)}
      <p class="full muted" id="senhaErro" style="margin:0"></p></div>`,
    foot: `<button class="btn" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" id="senhaOk">Entrar</button>`,
    onOpen() {
      const ok = async () => {
        const f = formData(), b = barbeiro(f.barbeiroId), err = document.getElementById('senhaErro');
        err.style.color = 'var(--danger)';
        if (!b.senhaHash) return (err.textContent = 'Este barbeiro ainda não tem senha. Peça à gerência para definir.');
        if (!conferirSenha(f.senha, b.senhaHash, async (novo) => {
          b.senhaHash = novo;
          try { await atualizar('barbeiros', b.id, b); } catch (e) { erroSync(e); }
        })) return (err.textContent = 'Senha incorreta.');
        closeModal(); entrarComo('barbeiro', b.id);
      };
      document.getElementById('senhaOk').onclick = ok;
      modalEl.querySelector('[name=senha]').onkeydown = (e) => { if (e.key === 'Enter') ok(); };
    },
  });
}

function loginGerencia() {
  const ativos = db.gerencia.filter((g) => g.ativo !== false);
  
  // Se não existir nenhum gerente, força criação do primeiro
  if (!ativos.length) {
    return modalCriarPrimeiroGerente(() => entrarComo('gerencia'));
  }

  openModal({
    title: 'Entrar como Gerência',
    body: `<div class="form-grid">
      ${field('Gerente', `<select name="gerenteId">${ativos.map((g) => `<option value="${g.id}">${esc(g.nome)}</option>`).join('')}</select>`, true)}
      ${field('Senha', `<input type="password" name="senha" autocomplete="current-password">`, true)}
      <p class="full muted" id="gerLoginErro" style="margin:0"></p></div>`,
    foot: `<button class="btn" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" id="gerLoginOk">Entrar</button>`,
    onOpen() {
      const ok = async () => {
        const f = formData(), err = document.getElementById('gerLoginErro');
        const g = gerente(f.gerenteId);
        err.style.color = 'var(--danger)';
        
        if (!g || !conferirSenha(f.senha, g.senhaHash, async (novo) => {
          g.senhaHash = novo;
          try { await atualizar('usuarios_gerencia', g.id, g); } catch(e) { erroSync(e); }
        })) {
          return (err.textContent = 'Senha incorreta.');
        }
        
        closeModal();
        entrarComo('gerencia', g.id);
      };
      document.getElementById('gerLoginOk').onclick = ok;
      modalEl.querySelector('[name=senha]').onkeydown = (e) => { if (e.key === 'Enter') ok(); };
    },
  });
}

// Modal especial para quando NÃO existe nenhum gerente cadastrado
function modalCriarPrimeiroGerente(depois) {
  openModal({
    title: 'Criar primeiro acesso gerencial',
    body: `<div class="form-grid">
      <p class="full modal-msg" style="margin:0">Nenhum gerente cadastrado. Crie o primeiro acesso agora.</p>
      ${field('Seu nome', `<input name="nome">`, true)}
      ${field('Senha (mín. 4)', `<input type="password" name="senha">`, true)}
      ${field('Repetir senha', `<input type="password" name="rep">`, true)}
      <p class="full muted" id="primeiroGerErro" style="margin:0"></p>
    </div>`,
    foot: `<button class="btn btn-primary" id="primeiroGerOk">Criar e Entrar</button>`,
    onOpen() {
      document.getElementById('primeiroGerOk').onclick = async () => {
        const f = formData(), err = document.getElementById('primeiroGerErro');
        err.style.color = 'var(--danger)';
        if (!f.nome) return (err.textContent = 'Informe seu nome.');
        if (f.senha.length < 4) return (err.textContent = 'Senha mínima de 4 caracteres.');
        if (f.senha !== f.rep) return (err.textContent = 'As senhas não conferem.');
        
        try {
          const novo = await inserir('usuarios_gerencia', { 
            nome: f.nome, 
            senhaHash: hashSenha(f.senha), 
            ativo: true 
          });
          db.gerencia.push(novo);
          closeModal();
          depois(novo.id);
        } catch (e) { erroSync(e); }
      };
    },
  });
}

// Validação de senha para ações críticas: usa a senha do gerente LOGADO
function comSenha(acao, motivo = 'Esta ação exige confirmação gerencial.') {
  if (perfil !== 'gerencia' || !gerenteAtualId) {
    return loginGerencia();
  }
  
  const g = gerente(gerenteAtualId);
  if (!g) return loginGerencia(); // Gerente pode ter sido excluído

  openModal({
    title: 'Confirmar ação',
    body: `<div class="form-grid">
      <p class="full modal-msg" style="margin:0">${motivo}</p>
      ${field(`Senha de ${esc(g.nome)}`, `<input type="password" name="senha" autocomplete="current-password">`, true)}
      <p class="full muted" id="confirmaErro" style="margin:0"></p></div>`,
    foot: `<button class="btn" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" id="confirmaOk">Confirmar</button>`,
    onOpen() {
      const ok = () => {
        const v = modalEl.querySelector('[name=senha]').value;
        if (conferirSenha(v, g.senhaHash)) {
          closeModal(); acao();
        } else {
          const err = document.getElementById('confirmaErro');
          err.textContent = 'Senha incorreta.'; err.style.color = 'var(--danger)';
        }
      };
      document.getElementById('confirmaOk').onclick = ok;
      modalEl.querySelector('[name=senha]').onkeydown = (e) => { if (e.key === 'Enter') ok(); };
    },
  });
}

function bloquear() { sair(); }

function aplicarPerfil() {
  const login = document.getElementById('login'), app = document.getElementById('app');
  login.hidden = !!perfil; app.hidden = !perfil;
  if (!perfil) { renderLogin(); return; }
  document.querySelectorAll('.nav-item').forEach((a) => (a.hidden = !telaPermitida(a.dataset.view)));
  
  const nomePerfil = perfil === 'gerencia' 
    ? (gerente(gerenteAtualId)?.nome || 'Gerência') 
    : (barbeiro(barbeiroAtualId)?.nome || 'Barbeiro');
  document.getElementById('perfilNome').textContent = nomePerfil;
}

function renderLogin() {
  document.getElementById('login').innerHTML = `<div class="login-box"><div class="rule"></div><div class="login-hero"><div class="login-logo">${LOGO_SVG}</div></div><p class="login-sub">Quem está usando o sistema?</p><div class="login-options"><button class="login-opt" onclick="loginBarbeiro()"><span class="login-ico">💈</span><span class="login-t">Barbeiro</span></button><button class="login-opt gerencia" onclick="loginGerencia()"><span class="login-ico">🔑</span><span class="login-t">Gerência barbearia</span></button></div></div>`;
}

function telaBloqueada(oQue) {
  return `<div class="panel"><div class="empty" style="padding:48px"><div style="font-size:40px;margin-bottom:8px">🔒</div><p style="font-size:15px;color:var(--ink)">${oQue} é uma área gerencial protegida por senha.</p><button class="btn btn-primary" onclick="comSenha(render)">Entrar como Gerência</button></div></div>`;
}

// =====================================================================
// VIEWS
// =====================================================================
const TITULOS = { dashboard: 'Dashboard', agendamentos: 'Agendamentos', atendimentos: 'Atendimentos', clientes: 'Clientes', servicos: 'Serviços', combos: 'Combos', caixa: 'Caixa', relatorios: 'Relatórios', estoque: 'Estoque', barbeiros: 'Barbeiros', gerentes: 'Gerentes', backup: 'Backup e segurança' };
let viewAtual = 'dashboard';
const viewState = { clienteBusca: '', caixaMes: mesAtual(), agendaFiltro: 'proximos', atendMes: mesAtual(), relIni: mesAtual() + '-01', relFim: hojeISO(), relBarb: '', relPct: '', estoqueBusca: '', estoqueBaixo: false };

function navigate(view) {
  if (!TITULOS[view] || !telaPermitida(view)) view = telaInicial();
  viewAtual = view;
  document.querySelectorAll('.nav-item').forEach((a) => a.classList.toggle('active', a.dataset.view === view));
  document.getElementById('pageTitle').textContent = TITULOS[view];
  menuLateral(false);
  render();
}
function render() {
  const content = document.getElementById('content');
  const actions = document.getElementById('topbarActions');
  const v = VIEWS[viewAtual]();
  actions.innerHTML = v.actions || '';
  content.innerHTML = v.html;
  v.after && v.after();
  window.scrollTo(0, 0);
}
const btnAdd = (label, fn) => `<button class="btn btn-primary" onclick="${fn}">＋ <span class="txt">${label}</span></button>`;

const VIEWS = {
  // ---------------- DASHBOARD ----------------
  dashboard() {
    const hoje = hojeISO(), mes = mesAtual();
    const fatDia = faturamento((a) => a.data === hoje);
    const fatMes = faturamento((a) => String(a.data).startsWith(mes));
    const atDia = db.atendimentos.filter((a) => a.data === hoje).length;
    const atMes = db.atendimentos.filter((a) => String(a.data).startsWith(mes)).length;
    const proximos = db.agendamentos
      .filter((a) => ['agendado', 'confirmado'].includes(a.status) && a.data >= hoje)
      .sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora)).slice(0, 6);
    const ultimos = [...db.atendimentos].sort((a, b) => (b.data + b.hora).localeCompare(a.data + a.hora)).slice(0, 6);
    const cx = resumoCaixa((l) => String(l.data).startsWith(mes));
    return {
      actions: btnAdd('Atendimento', 'modalAtendimento()'),
      html: `
      <div class="cards">
        <div class="card accent"><div class="card-label">Faturamento hoje</div><div class="card-value">${R$(fatDia)}</div><div class="card-sub">${atDia} atendimento(s)</div></div>
        <div class="card"><div class="card-label">Faturamento do mês</div><div class="card-value">${R$(fatMes)}</div><div class="card-sub">${atMes} atendimento(s)</div></div>
        <div class="card ok"><div class="card-label">Saldo do caixa (mês)</div><div class="card-value">${R$(cx.saldo)}</div><div class="card-sub">Saídas: ${R$(cx.saidas)}</div></div>
        ${(db.produtos || []).length ? `<div class="card ${abaixoDoMinimo().length ? 'danger' : ''}"><div class="card-label">Estoque</div><div class="card-value">${abaixoDoMinimo().length}</div><div class="card-sub">${abaixoDoMinimo().length ? 'produto(s) para repor' : 'tudo acima do mínimo'}</div></div>` : ''}
        <div class="card info"><div class="card-label">Agendamentos futuros</div><div class="card-value">${db.agendamentos.filter((a) => ['agendado', 'confirmado'].includes(a.status) && a.data >= hoje).length}</div><div class="card-sub">${db.clientes.length} clientes cadastrados</div></div>
      </div>
      <div class="grid-2">
        <div class="panel">
          <div class="panel-head"><h3>Próximos agendamentos</h3><button class="btn btn-sm" onclick="navigate('agendamentos')">Ver agenda</button></div>
          ${proximos.length ? proximos.map(agendaItem).join('') : '<div class="empty">Nenhum agendamento futuro.</div>'}
        </div>
        <div class="panel">
          <div class="panel-head"><h3>Últimos atendimentos</h3><button class="btn btn-sm" onclick="navigate('atendimentos')">Ver todos</button></div>
          <div class="table-wrap"><table><thead><tr><th>Data</th><th>Cliente</th><th>Serviço</th><th class="num">Valor</th></tr></thead><tbody>
          ${ultimos.length ? ultimos.map((a) => `<tr><td>${fmtData(a.data)} <span class="muted">${String(a.hora).slice(0,5)}</span></td><td class="strong">${esc(nomeCliente(a))}</td><td>${esc(a.descricao)}</td><td class="num strong">${R$(a.valorFinal)}</td></tr>`).join('') : '<tr><td colspan="4" class="empty">Nenhum atendimento.</td></tr>'}
          </tbody></table></div>
        </div>
      </div>`,
    };
  },

  // ---------------- SERVIÇOS ----------------
  servicos() {
    const list = [...db.servicos].sort((a, b) => a.nome.localeCompare(b.nome));
    return {
      actions: desbloqueado() ? btnAdd('Serviço', 'modalServico()') : '',
      html: `<div class="panel"><div class="table-wrap"><table><thead><tr><th>Nome</th><th>Categoria</th><th>Duração</th><th class="num">Valor</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.length ? list.map((s) => `<tr>
        <td class="strong">${esc(s.nome)}</td><td>${esc(s.categoria || '—')}</td><td>${s.duracao} min</td>
        <td class="num strong">${R$(s.valor)}</td>
        <td><span class="badge badge-${s.ativo ? 'ativo' : 'inativo'}">${s.ativo ? 'Ativo' : 'Inativo'}</span></td>
        <td class="actions">${desbloqueado() ? `<button class="btn btn-sm" onclick="modalServico(${s.id})">Editar</button> <button class="btn btn-sm" onclick="toggleServico(${s.id})">${s.ativo ? 'Desativar' : 'Ativar'}</button> <button class="btn btn-sm btn-danger" onclick="excluirServico(${s.id})">Excluir</button>` : `<span class="muted" style="font-size:12px">🔒 gerência</span>`}</td>
      </tr>`).join('') : '<tr><td colspan="6" class="empty">Nenhum serviço cadastrado.</td></tr>'}
      </tbody></table></div></div>
      <p class="muted">${desbloqueado() ? 'Ao alterar o preço de um serviço, os atendimentos já registrados mantêm o valor cobrado na época.' : 'Somente a gerência pode cadastrar ou alterar serviços.'}</p>`,
    };
  },

  // ---------------- CLIENTES ----------------
  clientes() {
    const q = viewState.clienteBusca.toLowerCase();
    const list = db.clientes.filter((c) => !q || c.nome.toLowerCase().includes(q) || (c.telefone || '').includes(q)).sort((a, b) => a.nome.localeCompare(b.nome));
    return {
      actions: btnAdd('Cliente', 'modalCliente()'),
      html: `<div class="panel"><div class="panel-head"><h3>${db.clientes.length} cliente(s)</h3><input class="search" id="buscaCliente" placeholder="Buscar por nome ou telefone…" value="${esc(viewState.clienteBusca)}"></div>
      <div class="table-wrap"><table><thead><tr><th>Nome</th><th>Telefone</th><th class="num">Atendimentos</th><th>Último</th><th class="num">Total gasto</th><th></th></tr></thead><tbody>
      ${list.length ? list.map((c) => { const st = statsCliente(c.id); return `<tr>
        <td><div class="strong">${esc(c.nome)}</div>${c.obs ? `<div class="muted" style="font-size:12px">${esc(c.obs)}</div>` : ''}</td>
        <td>${esc(c.telefone || '—')}</td><td class="num">${st.qtd}</td><td>${fmtData(st.ultimo)}</td><td class="num strong">${R$(st.total)}</td>
        <td class="actions">
          <button class="btn btn-sm" onclick="modalAgendamento(null,${c.id})">Agendar</button>
          <button class="btn btn-sm" onclick="modalCliente(${c.id})">Editar</button>
          <button class="btn btn-sm btn-danger" onclick="excluirCliente(${c.id})">Excluir</button>
        </td></tr>`; }).join('') : '<tr><td colspan="6" class="empty">Nenhum cliente encontrado.</td></tr>'}
      </tbody></table></div></div>`,
      after() {
        const i = document.getElementById('buscaCliente');
        i.addEventListener('input', () => { viewState.clienteBusca = i.value; const pos = i.selectionStart; render(); const n = document.getElementById('buscaCliente'); n.focus(); n.setSelectionRange(pos, pos); });
      },
    };
  },

  // ---------------- AGENDAMENTOS ----------------
  agendamentos() {
    const hoje = hojeISO();
    const f = viewState.agendaFiltro;
    let list = [...db.agendamentos];
    if (f === 'proximos') list = list.filter((a) => a.data >= hoje && a.status !== 'cancelado');
    else if (f === 'hoje') list = list.filter((a) => a.data === hoje);
    else if (f === 'passados') list = list.filter((a) => a.data < hoje);
    list.sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora));
    const dias = {};
    list.forEach((a) => (dias[a.data] ||= []).push(a));
    const keys = Object.keys(dias).sort();
    if (f === 'passados') keys.reverse();
    return {
      actions: btnAdd('Agendamento', 'modalAgendamento()'),
      html: `<div class="panel"><div class="panel-head"><h3>Agenda</h3>
        <div class="filters">
          <select id="agendaFiltro">
            <option value="proximos" ${f === 'proximos' ? 'selected' : ''}>Próximos</option>
            <option value="hoje" ${f === 'hoje' ? 'selected' : ''}>Hoje</option>
            <option value="passados" ${f === 'passados' ? 'selected' : ''}>Passados</option>
            <option value="todos" ${f === 'todos' ? 'selected' : ''}>Todos</option>
          </select></div></div>
        <div class="panel-body">${keys.length ? `<div class="agenda-grid">${keys.map((d) => `
          <div class="agenda-day"><div class="agenda-day-head ${d === hoje ? 'today' : ''}"><span>${d === hoje ? 'Hoje · ' : ''}${fmtDataExt(d)}</span><span class="cnt">${dias[d].length} horário(s)</span></div>
          ${dias[d].map(agendaItem).join('')}</div>`).join('')}</div>` : '<div class="empty">Nenhum agendamento neste filtro.</div>'}</div></div>`,
      after() { document.getElementById('agendaFiltro').onchange = (e) => { viewState.agendaFiltro = e.target.value; render(); }; },
    };
  },

  // ---------------- ATENDIMENTOS ----------------
  atendimentos() {
    const mes = viewState.atendMes;
    const list = db.atendimentos
      .filter((a) => !mes || String(a.data).startsWith(mes))
      .filter((a) => desbloqueado() || Number(a.barbeiroId) === Number(barbeiroAtualId))
      .sort((a, b) => (b.data + b.hora).localeCompare(a.data + a.hora));
    const total = list.reduce((s, a) => s + Number(a.valorFinal), 0);
    return {
      actions: btnAdd('Atendimento', 'modalAtendimento()'),
      html: `<div class="panel"><div class="panel-head"><h3>${list.length} atendimento(s) · ${R$(total)}${desbloqueado() ? '' : ' <span class="muted" style="font-size:12px;text-transform:none">(seus atendimentos)</span>'}</h3>
      <div class="filters"><label class="muted">Mês</label><input type="month" id="atendMes" value="${mes}"><button class="btn btn-sm" onclick="viewState.atendMes='';render()">Todos</button></div></div>
      <div class="table-wrap"><table><thead><tr><th>Data</th><th>Cliente</th><th>Serviço</th><th>Barbeiro</th><th class="num">Valor</th><th class="num">Desc.</th><th class="num">Final</th><th>Pagamento</th><th></th></tr></thead><tbody>
      ${list.length ? list.map((a) => `<tr>
        <td>${fmtData(a.data)} <span class="muted">${String(a.hora).slice(0,5)}</span></td><td class="strong">${esc(nomeCliente(a))}</td><td>${esc(a.descricao)}</td><td>${esc(nomeBarbeiro(a))}</td>
        <td class="num">${R$(a.valor)}</td><td class="num muted">${a.desconto ? '- ' + R$(a.desconto) : '—'}</td><td class="num strong">${R$(a.valorFinal)}</td>
        <td><span class="badge badge-pay">${PAGAMENTOS[a.pagamento]}</span></td>
        <td class="actions">${desbloqueado() ? `<button class="btn btn-sm btn-danger" onclick="excluirAtendimento(${a.id})">Excluir</button>` : ''}</td>
      </tr>`).join('') : '<tr><td colspan="9" class="empty">Nenhum atendimento neste período.</td></tr>'}
      </tbody></table></div></div>`,
      after() { document.getElementById('atendMes').onchange = (e) => { viewState.atendMes = e.target.value; render(); }; },
    };
  },

  // ---------------- CAIXA ----------------
  caixa() {
    if (!desbloqueado()) return { html: telaBloqueada('O caixa') };
    const mes = viewState.caixaMes;
    const filtro = (l) => !mes || String(l.data).startsWith(mes);
    const r = resumoCaixa(filtro);
    const list = db.caixa.filter(filtro).sort((a, b) => b.data.localeCompare(a.data) || b.id - a.id);
    return {
      actions: `<button class="btn" onclick="modalLancamento('entrada')">＋ <span class="txt">Entrada</span></button>` + btnAdd('Despesa', "modalLancamento('saida')"),
      html: `<div class="cards"><div class="card ok"><div class="card-label">Entradas</div><div class="card-value">${R$(r.entradas)}</div></div><div class="card danger"><div class="card-label">Saídas</div><div class="card-value">${R$(r.saidas)}</div></div><div class="card accent"><div class="card-label">Saldo</div><div class="card-value">${R$(r.saldo)}</div></div></div>
      <div class="cards"><div class="card"><div class="card-label">Dinheiro</div><div class="card-value">${R$(r.dinheiro)}</div></div><div class="card"><div class="card-label">Pix</div><div class="card-value">${R$(r.pix)}</div></div><div class="card"><div class="card-label">Débito</div><div class="card-value">${R$(r.debito)}</div></div><div class="card"><div class="card-label">Crédito</div><div class="card-value">${R$(r.credito)}</div></div></div>
      <div class="panel"><div class="panel-head"><h3>Lançamentos</h3><div class="filters"><label class="muted">Mês</label><input type="month" id="caixaMes" value="${mes}"><button class="btn btn-sm" onclick="viewState.caixaMes='';render()">Todos</button></div></div>
      <div class="table-wrap"><table><thead><tr><th>Data</th><th>Tipo</th><th>Descrição</th><th>Categoria</th><th>Pagamento</th><th class="num">Valor</th><th></th></tr></thead><tbody>
      ${list.length ? list.map((l) => `<tr>
        <td>${fmtData(l.data)}</td><td><span class="badge badge-${l.tipo}">${l.tipo === 'entrada' ? 'Entrada' : 'Saída'}</span></td>
        <td class="strong">${esc(l.descricao)}</td><td>${esc(l.categoria)}</td><td><span class="badge badge-pay">${PAGAMENTOS[l.pagamento]}</span></td>
        <td class="num strong" style="color:${l.tipo === 'entrada' ? 'var(--ok)' : 'var(--danger)'}">${l.tipo === 'entrada' ? '+' : '-'} ${R$(l.valor)}</td>
        <td class="actions">${l.atendimentoId ? '<span class="muted" style="font-size:12px">via atendimento</span>' : `<button class="btn btn-sm" onclick="modalLancamento('${l.tipo}',${l.id})">Editar</button><button class="btn btn-sm btn-danger" onclick="excluirLancamento(${l.id})">Excluir</button>`}</td>
      </tr>`).join('') : '<tr><td colspan="7" class="empty">Nenhum lançamento neste período.</td></tr>'}
      </tbody></table></div></div>`,
      after() { document.getElementById('caixaMes').onchange = (e) => { viewState.caixaMes = e.target.value; render(); }; },
    };
  },

  // ---------------- COMBOS ----------------
  combos() {
    return {
      actions: desbloqueado() ? btnAdd('Combo', 'modalCombo()') : '',
      html: db.combos.length ? `<div class="combo-grid">${db.combos.map((c) => { const servs = (c.servicoIds || []).map(servico).filter(Boolean); const normal = servs.reduce((s, x) => s + Number(x.valor), 0); const econ = normal - Number(c.valor); return `<div class="combo">
        <div style="display:flex;justify-content:space-between;align-items:center"><h3>${esc(c.nome)}</h3><span class="badge badge-${c.ativo !== false ? 'ativo' : 'inativo'}">${c.ativo !== false ? 'Ativo' : 'Inativo'}</span></div>
        <ul>${servs.map((s) => `<li>${esc(s.nome)} <span class="muted">— ${R$(s.valor)}</span></li>`).join('')}</ul>
        <div class="prices"><div><div class="old">Normal: ${R$(normal)}</div><div class="save">${econ > 0 ? `Economia de ${R$(econ)} (${Math.round((econ / normal) * 100)}%)` : 'Sem desconto'}</div></div><div class="new">${R$(c.valor)}</div></div>
        ${desbloqueado() ? `<div class="row"><button class="btn btn-sm" onclick="modalCombo(${c.id})">Editar</button><button class="btn btn-sm" onclick="toggleCombo(${c.id})">${c.ativo !== false ? 'Desativar' : 'Ativar'}</button><button class="btn btn-sm btn-danger" onclick="excluirCombo(${c.id})">Excluir</button></div>` : ''}
      </div>`; }).join('')}</div>` : `<div class="panel"><div class="empty">Nenhum combo cadastrado. Crie um combo juntando dois ou mais serviços.</div></div>`,
    };
  },

  // ---------------- RELATÓRIOS ----------------
  relatorios() {
    if (!desbloqueado()) return { html: telaBloqueada('A área de relatórios') };
    return telaRelatorios();
  },

  // ---------------- ESTOQUE ----------------
  estoque() {
    return telaEstoque();
  },

  // ---------------- BARBEIROS ----------------
  barbeiros() {
    const mes = mesAtual();
    const list = [...db.barbeiros].sort((a, b) => a.nome.localeCompare(b.nome));
    return {
      actions: btnAdd('Barbeiro', 'modalBarbeiro()'),
      html: `<div class="panel"><div class="table-wrap"><table><thead><tr><th>Nome</th><th>Telefone</th><th>Senha</th><th class="num">Comissão</th><th class="num">Atend. no mês</th><th class="num">Faturado no mês</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.length ? list.map((b) => { const ats = db.atendimentos.filter((a) => Number(a.barbeiroId) === Number(b.id) && String(a.data).startsWith(mes)); return `<tr>
        <td class="strong">${esc(b.nome)}</td><td>${esc(b.telefone || '—')}</td>
        <td>${b.senhaHash ? '<span class="badge badge-ativo">Definida</span>' : '<span class="badge badge-cancelado">Sem senha</span>'}</td>
        <td class="num">${b.comissao ? b.comissao + '%' : '—'}</td>
        <td class="num">${ats.length}</td><td class="num strong">${R$(ats.reduce((s, a) => s + Number(a.valorFinal), 0))}</td>
        <td><span class="badge badge-${b.ativo !== false ? 'ativo' : 'inativo'}">${b.ativo !== false ? 'Ativo' : 'Inativo'}</span></td>
        <td class="actions">
          <button class="btn btn-sm" onclick="modalBarbeiro(${b.id})">Editar</button>
          <button class="btn btn-sm btn-danger" onclick="excluirBarbeiro(${b.id})">Excluir</button>
        </td></tr>`; }).join('') : '<tr><td colspan="8" class="empty">Nenhum barbeiro cadastrado. Cadastre para liberar o login na tela inicial.</td></tr>'}
      </tbody></table></div></div>
      <p class="muted">Cada barbeiro entra na tela inicial escolhendo o próprio nome e digitando a senha definida aqui.</p>
      <p class="muted">O relatório de comissões, com exportação em PDF e Excel, está na aba <strong>Relatórios</strong>.</p>`,
    };
  },

  // ---------------- GERENTES ----------------
  gerentes() {
    if (!desbloqueado()) return { html: telaBloqueada('A gestão de gerentes') };
    const list = [...db.gerencia].sort((a,b) => a.nome.localeCompare(b.nome));
    return {
      actions: btnAdd('Gerente', 'modalGerente()'),
      html: `<div class="panel"><div class="table-wrap"><table>
        <thead><tr><th>Nome</th><th>Status</th><th>Criado em</th><th></th></tr></thead>
        <tbody>${list.map(g => `<tr>
          <td class="strong">${esc(g.nome)}</td>
          <td><span class="badge badge-${g.ativo !== false ? 'ativo' : 'inativo'}">${g.ativo !== false ? 'Ativo' : 'Inativo'}</span></td>
          <td>${g.criadoEm ? new Date(g.criadoEm).toLocaleDateString('pt-BR') : '—'}</td>
          <td class="actions">
            <button class="btn btn-sm" onclick="modalGerente(${g.id})">Editar</button>
            <button class="btn btn-sm btn-danger" onclick="excluirGerente(${g.id})">Excluir</button>
          </td>
        </tr>`).join('')}</tbody>
      </table></div></div>
      <p class="muted">Cada gerente possui login e senha individuais.</p>`,
    };
  },

  // ---------------- BACKUP ----------------
  backup() {
    return {
      html: `<div class="grid-2">
        <div class="panel"><div class="panel-head"><h3>Exportar backup</h3></div><div class="panel-body">
          <p>Gera um arquivo <strong>JSON</strong> com todos os dados. Guarde esse arquivo em local seguro.</p>
          <button class="btn btn-primary" onclick="exportarBackup()">⬇ Baixar backup</button>
        </div></div>
        <div class="panel"><div class="panel-head"><h3>Importar backup</h3></div><div class="panel-body">
          <p>Selecione um arquivo de backup. <strong>Os dados atuais serão substituídos</strong> — você vai confirmar antes.</p>
          <input type="file" id="importFile" accept="application/json,.json">
        </div></div>
      </div>
      <div class="panel"><div class="panel-head"><h3>Zona de perigo</h3></div><div class="panel-body">
        <p class="muted">Apaga todos os dados da nuvem e recria os dados de teste.</p>
        <button class="btn btn-danger" onclick="resetarDados()">Apagar tudo e reiniciar</button>
      </div></div>`,
      after() { document.getElementById('importFile').onchange = importarBackup; },
    };
  },
};

function agendaItem(a) {
  const s = a.tipo === 'combo' ? combo(a.servicoId) : servico(a.servicoId);
  return `<div class="agenda-item ${a.status}" onclick="modalAgendamento(${a.id})">
    <div class="hora">${String(a.hora).slice(0,5)}</div>
    <div class="info"><div class="n">${esc(cliente(a.clienteId)?.nome || 'Cliente removido')}</div>
    <div class="s">${esc(s?.nome || 'Serviço removido')}${a.barbeiroId ? ' · ' + esc(nomeBarbeiro(a)) : ''}${a.obs ? ' · ' + esc(a.obs) : ''}</div>
    <div style="margin-top:4px"><span class="badge badge-${a.status}">${STATUS[a.status]}</span> <span class="muted" style="font-size:12px">${fmtData(a.data)}</span></div></div>
  </div>`;
}

// =====================================================================
// SERVIÇOS
// =====================================================================
function modalServico(id) {
  if (!desbloqueado()) return comSenha(() => modalServico(id), 'Alterar serviços exige a senha gerencial.');
  const s = id ? servico(id) : { nome: '', categoria: '', duracao: 30, valor: '', ativo: true };
  openModal({
    title: id ? 'Editar serviço' : 'Novo serviço',
    body: `<div class="form-grid">
      ${field('Nome *', `<input name="nome" value="${esc(s.nome)}" placeholder="Ex.: Corte">`, true)}
      ${field('Categoria', `<input name="categoria" list="cats" value="${esc(s.categoria)}" placeholder="Ex.: Cabelo"><datalist id="cats">${[...new Set(db.servicos.map((x) => x.categoria).filter(Boolean))].map((c) => `<option value="${esc(c)}">`).join('')}</datalist>`)}
      ${field('Duração (min)', `<input name="duracao" type="number" min="5" step="5" value="${s.duracao}">`)}
      ${field('Valor (R$) *', `<input name="valor" type="number" min="0" step="0.01" value="${s.valor}">`)}
      <div class="field"><label>Status</label><label class="check"><input type="checkbox" name="ativo" ${s.ativo ? 'checked' : ''}> Serviço ativo</label></div>
    </div>`,
    foot: `<button class="btn" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="salvarServico(${id || 0})">Salvar</button>`,
  });
}
async function salvarServico(id) {
  const f = formData();
  if (!f.nome || f.valor === '') return toast('Preencha nome e valor.');
  const dados = { nome: f.nome, categoria: f.categoria, duracao: Number(f.duracao) || 0, valor: Number(f.valor), ativo: f.ativo };
  try {
    if (id) {
      Object.assign(servico(id), dados);
      await atualizar('servicos', id, servico(id));
    } else {
      const novo = await inserir('servicos', dados);
      db.servicos.push(novo);
    }
    closeModal(); render(); toast('Serviço salvo');
  } catch (e) { erroSync(e); }
}
async function toggleServico(id) {
  if (!desbloqueado()) return comSenha(() => toggleServico(id));
  const s = servico(id); s.ativo = !s.ativo;
  try { await atualizar('servicos', id, s); render(); } catch (e) { s.ativo = !s.ativo; erroSync(e); }
}
function excluirServico(id) {
  if (!desbloqueado()) return comSenha(() => excluirServico(id));
  const s = servico(id);
  const usado = db.combos.some((c) => (c.servicoIds || []).includes(id)) || db.agendamentos.some((a) => a.tipo === 'servico' && Number(a.servicoId) === Number(id) && a.status !== 'cancelado' && a.status !== 'concluido');
  confirmar(`Excluir o serviço <strong>${esc(s.nome)}</strong>?${usado ? '<br><br><span class="muted">Ele está em uso em combos ou agendamentos. Considere apenas desativar.</span>' : ''}<br><br>Os atendimentos já registrados não serão afetados.`, async () => {
    try {
      await remover('servicos', id);
      db.servicos = db.servicos.filter((x) => Number(x.id) !== Number(id));
      for (const c of db.combos) {
        if ((c.servicoIds || []).includes(id)) {
          c.servicoIds = c.servicoIds.filter((x) => Number(x) !== Number(id));
          await atualizar('combos', c.id, c);
        }
      }
      render(); toast('Serviço excluído');
    } catch (e) { erroSync(e); }
  }, { okLabel: 'Excluir' });
}

// =====================================================================
// CLIENTES
// =====================================================================
function modalCliente(id) {
  const c = id ? cliente(id) : { nome: '', telefone: '', obs: '' };
  const st = id ? statsCliente(id) : null;
  openModal({
    title: id ? 'Editar cliente' : 'Novo cliente',
    body: `<div class="form-grid">
      ${field('Nome *', `<input name="nome" value="${esc(c.nome)}">`, true)}
      ${field('Telefone', `<input name="telefone" value="${esc(c.telefone)}" placeholder="(00) 00000-0000">`, true)}
      ${field('Observação', `<textarea name="obs" placeholder="Preferências, alergias, etc.">${esc(c.obs)}</textarea>`, true)}
      ${st ? `<div class="field full"><div class="total-box"><span>${st.qtd} atendimento(s) · último: ${fmtData(st.ultimo)}</span><span class="v">${R$(st.total)}</span></div></div>` : ''}
    </div>`,
    foot: `<button class="btn" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="salvarCliente(${id || 0})">Salvar</button>`,
  });
}
async function salvarCliente(id) {
  const f = formData();
  if (!f.nome) return toast('Informe o nome.');
  const dup = db.clientes.find((c) => Number(c.id) !== Number(id) && f.telefone && c.telefone === f.telefone);
  const gravar = async () => {
    try {
      if (id) {
        Object.assign(cliente(id), { nome: f.nome, telefone: f.telefone, obs: f.obs });
        await atualizar('clientes', id, cliente(id));
      } else {
        const novo = await inserir('clientes', { nome: f.nome, telefone: f.telefone, obs: f.obs, criadoEm: Date.now() });
        db.clientes.push(novo);
      }
      closeModal(); render(); toast('Cliente salvo');
    } catch (e) { erroSync(e); }
  };
  if (dup) return confirmar(`O telefone ${esc(f.telefone)} já está cadastrado para <strong>${esc(dup.nome)}</strong>. Cadastrar assim mesmo?`, gravar, { danger: false, okLabel: 'Cadastrar' });
  gravar();
}
function excluirCliente(id) {
  const c = cliente(id);
  confirmar(`Excluir o cliente <strong>${esc(c.nome)}</strong>?<br><br>Os atendimentos continuam no histórico, mas os agendamentos futuros dele serão removidos.`, async () => {
    try {
      for (const a of db.atendimentos.filter((x) => Number(x.clienteId) === Number(id))) {
        a.clienteNome = c.nome;
        await atualizar('atendimentos', a.id, a);
      }
      await remover('clientes', id);
      await removerOnde('agendamentos', 'clienteId', id);
      db.clientes = db.clientes.filter((x) => Number(x.id) !== Number(id));
      db.agendamentos = db.agendamentos.filter((a) => Number(a.clienteId) !== Number(id));
      render(); toast('Cliente excluído');
    } catch (e) { erroSync(e); }
  }, { okLabel: 'Excluir' });
}

// =====================================================================
// AGENDAMENTOS
// =====================================================================
function opcoesServicoCombo(tipo, id, apenasAtivos = true) {
  const sel = tipo && id ? `${tipo === 'combo' ? 'c' : 's'}:${id}` : '';
  const s = db.servicos.filter((x) => !apenasAtivos || x.ativo || sel === 's:' + x.id).map((x) => `<option value="s:${x.id}" ${sel === 's:' + x.id ? 'selected' : ''}>${esc(x.nome)} — ${R$(x.valor)}</option>`).join('');
  const c = db.combos.filter((x) => !apenasAtivos || x.ativo !== false || sel === 'c:' + x.id).map((x) => `<option value="c:${x.id}" ${sel === 'c:' + x.id ? 'selected' : ''}>${esc(x.nome)} — ${R$(x.valor)}</option>`).join('');
  return `<optgroup label="Serviços">${s}</optgroup>${c ? `<optgroup label="Combos">${c}</optgroup>` : ''}`;
}
function opcoesBarbeiro(sel) {
  const ativos = db.barbeiros.filter((b) => b.ativo !== false || Number(b.id) === Number(sel));
  return `<option value="">— Qualquer —</option>` + ativos.map((b) => `<option value="${b.id}" ${Number(sel) === Number(b.id) ? 'selected' : ''}>${esc(b.nome)}</option>`).join('');
}
function parseSel(v) { const [t, id] = v.split(':'); return { tipo: t === 'c' ? 'combo' : 'servico', id: Number(id) }; }
function itemDe(tipo, id) { return tipo === 'combo' ? combo(id) : servico(id); }

function modalAgendamento(id, clienteId) {
  if (!db.clientes.length) return toast('Cadastre um cliente primeiro.');
  if (!db.servicos.length) return toast('Cadastre um serviço primeiro.');
  const a = id ? byId(db.agendamentos, id) : { clienteId: clienteId || '', servicoId: '', tipo: 'servico', barbeiroId: barbeiroAtualId || '', data: hojeISO(), hora: '09:00', obs: '', status: 'agendado' };
  const clis = [...db.clientes].sort((x, y) => x.nome.localeCompare(y.nome));
  openModal({
    title: id ? 'Editar agendamento' : 'Novo agendamento',
    body: `<div class="form-grid">
      ${field('Cliente *', `<select name="clienteId"><option value="">Selecione…</option>${opts(clis, a.clienteId, (c) => c.nome)}</select>`, true)}
      ${field('Serviço / Combo *', `<select name="item">${opcoesServicoCombo(a.tipo, a.servicoId)}</select>`, true)}
      ${field('Barbeiro', `<select name="barbeiroId">${opcoesBarbeiro(a.barbeiroId)}</select>`, true)}
      ${field('Data *', `<input type="date" name="data" value="${a.data}">`)}
      ${field('Horário *', `<input type="time" name="hora" value="${String(a.hora).slice(0,5)}">`)}
      ${field('Status', `<select name="status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${a.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>`, true)}
      ${field('Observação', `<textarea name="obs">${esc(a.obs)}</textarea>`, true)}
    </div>`,
    foot: `${id ? `<button class="btn btn-danger" onclick="excluirAgendamento(${id})" style="margin-right:auto">Excluir</button>` : ''}
      ${id && a.status !== 'concluido' && a.status !== 'cancelado' ? `<button class="btn" onclick="concluirAgendamento(${id})">✔ Registrar atendimento</button>` : ''}
      <button class="btn" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="salvarAgendamento(${id || 0})">Salvar</button>`,
  });
}
async function salvarAgendamento(id) {
  const f = formData();
  if (!f.clienteId || !f.item || !f.data || !f.hora) return toast('Preencha cliente, serviço, data e horário.');
  const { tipo, id: sid } = parseSel(f.item);
  const dados = { clienteId: Number(f.clienteId), servicoId: sid, tipo, barbeiroId: Number(f.barbeiroId) || null, data: f.data, hora: f.hora, status: f.status, obs: f.obs };
  const conflito = db.agendamentos.find((x) => Number(x.id) !== Number(id) && x.data === f.data && String(x.hora).slice(0,5) === f.hora && x.status !== 'cancelado' && (!dados.barbeiroId || !x.barbeiroId || Number(x.barbeiroId) === Number(dados.barbeiroId)));
  const gravar = async () => {
    try {
      let agId = id;
      if (id) {
        Object.assign(byId(db.agendamentos, id), dados);
        await atualizar('agendamentos', id, byId(db.agendamentos, id));
      } else {
        const novo = await inserir('agendamentos', dados);
        db.agendamentos.push(novo);
        agId = novo.id;
      }
      closeModal(); render(); toast('Agendamento salvo');
      if (dados.status === 'concluido' && !db.atendimentos.some((a) => Number(a.clienteId) === Number(dados.clienteId) && a.data === dados.data && String(a.hora).slice(0,5) === dados.hora)) {
        confirmar('Agendamento marcado como concluído. Deseja registrar o atendimento agora para lançar o valor no caixa?',
          () => modalAtendimento({ clienteId: dados.clienteId, tipo: dados.tipo, servicoId: dados.servicoId, barbeiroId: dados.barbeiroId || barbeiroAtualId || '', data: dados.data, hora: dados.hora, agendamentoId: agId }),
          { danger: false, okLabel: 'Registrar atendimento' });
      }
    } catch (e) { erroSync(e); }
  };
  if (conflito) {
    return confirmar(`Já existe um agendamento às <strong>${esc(f.hora)}</strong> de ${fmtData(f.data)}${conflito.barbeiroId ? ' com ' + esc(nomeBarbeiro(conflito)) : ''} (${esc(cliente(conflito.clienteId)?.nome || 'cliente removido')}).<br><br>Salvar mesmo assim?`, gravar, { danger: false, okLabel: 'Salvar assim mesmo' });
  }
  gravar();
}
function excluirAgendamento(id) {
  confirmar('Excluir este agendamento?', async () => {
    try {
      await remover('agendamentos', id);
      db.agendamentos = db.agendamentos.filter((x) => Number(x.id) !== Number(id));
      render(); toast('Agendamento excluído');
    } catch (e) { erroSync(e); }
  }, { okLabel: 'Excluir' });
}
function concluirAgendamento(id) {
  const a = byId(db.agendamentos, id);
  closeModal();
  modalAtendimento({ clienteId: a.clienteId, tipo: a.tipo, servicoId: a.servicoId, barbeiroId: a.barbeiroId || barbeiroAtualId || '', data: a.data, hora: String(a.hora).slice(0,5), agendamentoId: a.id });
}

// =====================================================================
// ATENDIMENTOS
// =====================================================================
// Itens do atendimento em edição: [{ tipo, id, nome, qtd, valorUnit }]
let atItens = [];

function modalAtendimento(pre = {}) {
  if (!db.clientes.length) return toast('Cadastre um cliente primeiro.');
  if (!db.servicos.length) return toast('Cadastre um serviço primeiro.');
  const a = { clienteId: '', barbeiroId: barbeiroAtualId || '', data: hojeISO(), hora: horaAgora(), desconto: 0, pagamento: 'pix', ...pre };
  const clis = [...db.clientes].sort((x, y) => x.nome.localeCompare(y.nome));

  // Começa com o serviço/combo que veio do agendamento, se houver
  atItens = [];
  if (pre.servicoId) {
    const it = itemDe(pre.tipo || 'servico', pre.servicoId);
    if (it) atItens.push({ tipo: pre.tipo || 'servico', id: Number(it.id), nome: it.nome, qtd: 1, valorUnit: Number(it.valor) });
  }

  openModal({
    title: 'Registrar atendimento',
    body: `<div class="form-grid">
      ${field('Cliente *', `<select name="clienteId"><option value="">Selecione…</option>${opts(clis, a.clienteId, (c) => c.nome)}</select>`, true)}
      ${field('Barbeiro', `<select name="barbeiroId" ${perfil === 'barbeiro' ? 'disabled' : ''}>${opcoesBarbeiro(a.barbeiroId)}</select>`, true)}

      <div class="field full">
        <label>Serviços e combos *</label>
        <div class="filters">
          <select id="atNovoServico" style="flex:1;min-width:180px">${opcoesServicoCombo()}</select>
          <input type="number" id="atQtdServico" min="1" step="1" value="1" style="width:76px" title="Quantidade">
          <button type="button" class="btn" onclick="adicionarItemAtendimento('servico')">＋ Adicionar</button>
        </div>
        <span class="hint">Para somar mais de um serviço no mesmo atendimento, adicione um de cada vez.</span>
      </div>

      <div class="field full">
        <label>Produtos vendidos</label>
        ${opcoesProdutoAtendimento()
          ? `<div class="filters">
               <select id="atNovoProduto" style="flex:1;min-width:180px">${opcoesProdutoAtendimento()}</select>
               <input type="number" id="atQtdProduto" min="1" step="1" value="1" style="width:76px" title="Quantidade">
               <button type="button" class="btn" onclick="adicionarItemAtendimento('produto')">＋ Adicionar</button>
             </div>
             <span class="hint">O que for vendido aqui sai do estoque automaticamente.</span>`
          : `<span class="hint">Nenhum produto disponível em estoque no momento.${desbloqueado() ? ' Cadastre ou reponha na aba <strong>Estoque</strong>.' : ''}</span>`}
      </div>

      <div class="field full"><div id="atListaItens"></div></div>

      ${field('Data *', `<input type="date" name="data" value="${a.data}">`)}
      ${field('Horário *', `<input type="time" name="hora" value="${a.hora}">`)}
      ${field('Desconto (R$)', `<input type="number" step="0.01" min="0" name="desconto" id="atDesc" value="${a.desconto}">`)}
      ${field('Forma de pagamento *', `<select name="pagamento">${Object.entries(PAGAMENTOS).map(([k, v]) => `<option value="${k}" ${a.pagamento === k ? 'selected' : ''}>${v}</option>`).join('')}</select>`)}
      <div class="field full"><div class="total-box"><span id="atResumo">Subtotal</span><span class="v" id="atFinal">R$ 0,00</span></div></div>
      <input type="hidden" name="agendamentoId" value="${a.agendamentoId || ''}">
    </div>`,
    foot: `<button class="btn" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="salvarAtendimento()">Finalizar e lançar no caixa</button>`,
    onOpen() {
      document.getElementById('atDesc').oninput = pintarItensAtendimento;
      pintarItensAtendimento();
    },
  });
}

// Produtos disponíveis para venda durante o atendimento.
// A quantidade em estoque só aparece para a gerência: assim a contagem
// de inventário feita pelo barbeiro continua sendo às cegas.
function opcoesProdutoAtendimento() {
  return (db.produtos || [])
    .filter((x) => x.ativo !== false && Number(x.preco) > 0 && Number(x.estoque) > 0)
    .map((x) => `<option value="p:${x.id}">${esc(x.nome)} — ${R$(x.preco)}${desbloqueado() ? ` (${Number(x.estoque)} em estoque)` : ''}</option>`)
    .join('');
}

function itemAtendimentoDe(valorSel) {
  const [t, id] = String(valorSel).split(':');
  const tipo = t === 'c' ? 'combo' : t === 'p' ? 'produto' : 'servico';
  const obj = tipo === 'combo' ? combo(id) : tipo === 'produto' ? produto(id) : servico(id);
  if (!obj) return null;
  return { tipo, id: Number(obj.id), nome: obj.nome, qtd: 1, valorUnit: Number(tipo === 'produto' ? obj.preco : obj.valor) };
}

function adicionarItemAtendimento(origem = 'servico') {
  const sel = document.getElementById(origem === 'produto' ? 'atNovoProduto' : 'atNovoServico');
  const campoQtd = document.getElementById(origem === 'produto' ? 'atQtdProduto' : 'atQtdServico');
  if (!sel || !sel.value) return toast('Escolha um item.');
  const qtd = Math.max(1, Number(campoQtd.value) || 1);
  const novo = itemAtendimentoDe(sel.value);
  if (!novo) return toast('Escolha um item.');
  if (novo.tipo === 'produto') {
    const p = produto(novo.id);
    const jaNoCarrinho = atItens.filter((i) => i.tipo === 'produto' && i.id === novo.id).reduce((s, i) => s + i.qtd, 0);
    if (jaNoCarrinho + qtd > Number(p.estoque)) return toast(`Não há essa quantidade de ${p.nome} disponível.`);
  }
  const igual = atItens.find((i) => i.tipo === novo.tipo && i.id === novo.id);
  if (igual) igual.qtd += qtd; else atItens.push({ ...novo, qtd });
  campoQtd.value = 1;
  pintarItensAtendimento();
}

function removerItemAtendimento(idx) { atItens.splice(idx, 1); pintarItensAtendimento(); }

// Só a quantidade é ajustável: o valor unitário vem sempre do cadastro.
function alterarItemAtendimento(idx, valor) {
  const item = atItens[idx];
  if (!item) return;
  const n = Math.max(1, Number(valor) || 1);
  if (item.tipo === 'produto' && n > Number(produto(item.id)?.estoque || 0)) {
    toast(`Não há essa quantidade de ${item.nome} disponível.`);
    return pintarItensAtendimento();
  }
  item.qtd = n;
  pintarItensAtendimento();
}

function totaisAtendimento() {
  const servicos = atItens.filter((i) => i.tipo !== 'produto').reduce((s, i) => s + i.qtd * i.valorUnit, 0);
  const produtos = atItens.filter((i) => i.tipo === 'produto').reduce((s, i) => s + i.qtd * i.valorUnit, 0);
  const desconto = Number(document.getElementById('atDesc')?.value) || 0;
  const subtotal = servicos + produtos;
  return { servicos, produtos, subtotal, desconto, final: Math.max(0, subtotal - desconto) };
}

function pintarItensAtendimento() {
  const alvo = document.getElementById('atListaItens');
  if (!alvo) return;
  if (!atItens.length) {
    alvo.innerHTML = '<div class="empty" style="padding:16px">Nenhum item adicionado ainda.</div>';
  } else {
    alvo.innerHTML = `<div class="table-wrap"><table><thead><tr>
        <th>Item</th><th class="num" style="width:80px">Qtd.</th><th class="num" style="width:110px">Valor un.</th><th class="num">Total</th><th></th>
      </tr></thead><tbody>
      ${atItens.map((i, idx) => `<tr>
        <td class="strong">${esc(i.nome)} ${i.tipo === 'produto' ? '<span class="badge badge-pay">produto</span>' : i.tipo === 'combo' ? '<span class="badge badge-pay">combo</span>' : ''}</td>
        <td class="num"><input type="number" min="1" step="1" value="${i.qtd}" style="width:70px;text-align:right" onchange="alterarItemAtendimento(${idx},this.value)"></td>
        <td class="num">${R$(i.valorUnit)}</td>
        <td class="num strong">${R$(i.qtd * i.valorUnit)}</td>
        <td class="actions"><button type="button" class="btn btn-sm btn-danger" onclick="removerItemAtendimento(${idx})">✕</button></td>
      </tr>`).join('')}
      </tbody></table></div>`;
  }
  const t = totaisAtendimento();
  const resumo = document.getElementById('atResumo');
  const fin = document.getElementById('atFinal');
  if (resumo) resumo.innerHTML = `Serviços ${R$(t.servicos)}${t.produtos ? ` · Produtos ${R$(t.produtos)}` : ''}${t.desconto ? ` · Desconto ${R$(t.desconto)}` : ''}`;
  if (fin) fin.textContent = R$(t.final);
}

async function salvarAtendimento() {
  const f = formData();
  if (!f.clienteId || !f.data || !f.hora) return toast('Preencha cliente, data e horário.');
  if (!atItens.length) return toast('Adicione pelo menos um serviço ou produto.');

  const t = totaisAtendimento();
  if (t.desconto < 0) return toast('O desconto não pode ser negativo.');
  if (t.desconto > t.subtotal) return toast('O desconto não pode ser maior que o total dos itens.');

  // Confere o estoque antes de gravar qualquer coisa
  for (const i of atItens.filter((x) => x.tipo === 'produto')) {
    const p = produto(i.id);
    if (!p) return toast(`Produto "${i.nome}" não encontrado.`);
    if (i.qtd > Number(p.estoque || 0)) return toast(`Estoque insuficiente de ${p.nome}: restam ${Number(p.estoque || 0)}.`);
  }

  const cli = cliente(Number(f.clienteId));
  const bId = perfil === 'barbeiro' ? barbeiroAtualId : (Number(f.barbeiroId) || null);
  const principal = atItens.find((i) => i.tipo !== 'produto') || atItens[0];
  const descricao = atItens.map((i) => (i.qtd > 1 ? `${i.nome} x${i.qtd}` : i.nome)).join(' + ');
  // O desconto abate primeiro os serviços — é sobre eles que a comissão incide
  const baseComissao = Math.max(0, t.servicos - t.desconto);

  const registro = {
    clienteId: cli.id, clienteNome: cli.nome,
    tipo: principal.tipo === 'produto' ? 'servico' : principal.tipo,
    servicoId: principal.tipo === 'produto' ? null : principal.id,
    descricao,
    barbeiroId: bId, barbeiroNome: barbeiro(bId)?.nome || '',
    data: f.data, hora: f.hora,
    valor: t.subtotal, desconto: t.desconto, valorFinal: t.final, pagamento: f.pagamento,
  };
  if (db.atendItensOk !== false) {
    Object.assign(registro, {
      itens: atItens.map((i) => ({ tipo: i.tipo, id: i.id, nome: i.nome, qtd: i.qtd, valorUnit: i.valorUnit, total: i.qtd * i.valorUnit })),
      valorServicos: t.servicos, valorProdutos: t.produtos, baseComissao,
    });
  }

  try {
    const at = await inserir('atendimentos', registro);
    db.atendimentos.push(at);

    const lanc = await inserir('caixa', {
      tipo: 'entrada', descricao: `${descricao} — ${cli.nome}`, categoria: 'Atendimento',
      valor: t.final, data: f.data, pagamento: f.pagamento, atendimentoId: at.id,
    });
    db.caixa.push(lanc);

    // Baixa no estoque dos produtos vendidos no atendimento
    for (const i of atItens.filter((x) => x.tipo === 'produto')) {
      const p = produto(i.id);
      try {
        await registrarMov(p, 'venda', i.qtd, -i.qtd, {
          valorUnit: i.valorUnit, total: i.qtd * i.valorUnit, data: f.data,
          motivo: `Atendimento de ${cli.nome}`, caixaId: lanc.id,
        });
      } catch (e) { console.error('Falha ao baixar estoque', e); toast(`Atendimento salvo, mas o estoque de ${p.nome} não baixou.`); }
    }

    if (f.agendamentoId) {
      const ag = byId(db.agendamentos, f.agendamentoId);
      if (ag) { ag.status = 'concluido'; await atualizar('agendamentos', ag.id, ag); }
    }
    atItens = [];
    closeModal(); render(); toast('Atendimento registrado e lançado no caixa');
  } catch (e) { erroSync(e); }
}

function excluirAtendimento(id) {
  const at = byId(db.atendimentos, id);
  const prods = (at?.itens || []).filter((i) => i.tipo === 'produto');
  const avisoProd = prods.length ? `<br><br>Os produtos do atendimento (${prods.map((p) => esc(p.nome)).join(', ')}) voltam para o estoque.` : '';
  comSenha(() => confirmar('Excluir este atendimento? A entrada correspondente no caixa também será removida.' + avisoProd, async () => {
    try {
      // devolve os produtos ao estoque antes de apagar
      for (const i of prods) {
        const p = produto(i.id);
        if (p) { try { await registrarMov(p, 'entrada', i.qtd, i.qtd, { valorUnit: p.custo, motivo: 'Estorno de atendimento excluído' }); } catch (e) { console.error(e); } }
      }
      await removerOnde('caixa', 'atendimentoId', id);
      await remover('atendimentos', id);
      db.atendimentos = db.atendimentos.filter((x) => Number(x.id) !== Number(id));
      db.caixa = db.caixa.filter((l) => Number(l.atendimentoId) !== Number(id));
      render(); toast('Atendimento excluído');
    } catch (e) { erroSync(e); }
  }, { okLabel: 'Excluir' }), 'Excluir um atendimento remove também a entrada no caixa. Digite a senha gerencial.');
}

// =====================================================================
// CAIXA
// =====================================================================
function modalLancamento(tipo, id) {
  if (!desbloqueado()) return comSenha(() => modalLancamento(tipo, id));
  const l = id ? byId(db.caixa, id) : { descricao: '', categoria: tipo === 'saida' ? 'Produtos' : 'Outros', valor: '', data: hojeISO(), pagamento: 'dinheiro' };
  const cats = tipo === 'saida' ? CAT_DESPESA : ['Venda de produto', 'Outros'];
  openModal({
    title: id ? 'Editar lançamento' : tipo === 'saida' ? 'Nova despesa' : 'Nova entrada',
    body: `<div class="form-grid">
      ${field('Descrição *', `<input name="descricao" value="${esc(l.descricao)}" placeholder="${tipo === 'saida' ? 'Ex.: Compra de lâminas' : 'Ex.: Venda de pomada'}">`, true)}
      ${field('Categoria', `<select name="categoria">${cats.map((c) => `<option ${l.categoria === c ? 'selected' : ''}>${c}</option>`).join('')}</select>`)}
      ${field('Valor (R$) *', `<input type="number" step="0.01" min="0" name="valor" value="${l.valor}">`)}
      ${field('Data *', `<input type="date" name="data" value="${l.data}">`)}
      ${field('Forma de pagamento', `<select name="pagamento">${Object.entries(PAGAMENTOS).map(([k, v]) => `<option value="${k}" ${l.pagamento === k ? 'selected' : ''}>${v}</option>`).join('')}</select>`)}
    </div>`,
    foot: `<button class="btn" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="salvarLancamento('${tipo}',${id || 0})">Salvar</button>`,
  });
}
async function salvarLancamento(tipo, id) {
  const f = formData();
  if (!f.descricao || f.valor === '' || !f.data) return toast('Preencha descrição, valor e data.');
  const dados = { tipo, descricao: f.descricao, categoria: f.categoria, valor: Number(f.valor), data: f.data, pagamento: f.pagamento };
  try {
    if (id) {
      Object.assign(byId(db.caixa, id), dados);
      await atualizar('caixa', id, byId(db.caixa, id));
    } else {
      const novo = await inserir('caixa', dados);
      db.caixa.push(novo);
    }
    closeModal(); render(); toast('Lançamento salvo');
  } catch (e) { erroSync(e); }
}
function excluirLancamento(id) {
  comSenha(() => confirmar('Excluir este lançamento do caixa?', async () => {
    try {
      await remover('caixa', id);
      db.caixa = db.caixa.filter((x) => Number(x.id) !== Number(id));
      render(); toast('Lançamento excluído');
    } catch (e) { erroSync(e); }
  }, { okLabel: 'Excluir' }));
}

// =====================================================================
// COMBOS
// =====================================================================
function modalCombo(id) {
  if (!desbloqueado()) return comSenha(() => modalCombo(id), 'Alterar combos exige a senha gerencial.');
  if (db.servicos.length < 2) return toast('Cadastre pelo menos 2 serviços para criar um combo.');
  const c = id ? combo(id) : { nome: '', servicoIds: [], valor: '', ativo: true };
  openModal({
    title: id ? 'Editar combo' : 'Novo combo',
    body: `<div class="form-grid">
      ${field('Nome *', `<input name="nome" value="${esc(c.nome)}" placeholder="Ex.: Corte + Barba">`, true)}
      <div class="field full"><label>Serviços incluídos *</label>${db.servicos.map((s) => `<label class="check"><input type="checkbox" class="comboServ" value="${s.id}" ${(c.servicoIds || []).includes(s.id) ? 'checked' : ''}> ${esc(s.nome)} <span class="muted">— ${R$(s.valor)}</span></label>`).join('')}</div>
      ${field('Valor do combo (R$) *', `<input type="number" step="0.01" min="0" name="valor" id="comboValor" value="${c.valor}">`)}
      <div class="field"><label>Status</label><label class="check"><input type="checkbox" name="ativo" ${c.ativo !== false ? 'checked' : ''}> Combo ativo</label></div>
      <div class="field full"><div class="total-box"><span id="comboNormal">Valor normal: R$ 0,00</span><span class="v" id="comboEcon">—</span></div></div>
    </div>`,
    foot: `<button class="btn" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="salvarCombo(${id || 0})">Salvar</button>`,
    onOpen() {
      const upd = () => {
        const ids = [...modalEl.querySelectorAll('.comboServ:checked')].map((x) => Number(x.value));
        const normal = ids.reduce((s, i) => s + Number(servico(i)?.valor || 0), 0);
        const v = Number(document.getElementById('comboValor').value) || 0;
        document.getElementById('comboNormal').textContent = `Valor normal: ${R$(normal)}`;
        document.getElementById('comboEcon').textContent = v ? `Economia ${R$(normal - v)}` : '—';
      };
      modalEl.querySelectorAll('.comboServ').forEach((x) => (x.onchange = upd));
      document.getElementById('comboValor').oninput = upd; upd();
    },
  });
}
async function salvarCombo(id) {
  const f = formData();
  const ids = [...modalEl.querySelectorAll('.comboServ:checked')].map((x) => Number(x.value));
  if (!f.nome || f.valor === '' || ids.length < 2) return toast('Informe nome, valor e pelo menos 2 serviços.');
  const dados = { nome: f.nome, servicoIds: ids, valor: Number(f.valor), ativo: f.ativo };
  try {
    if (id) {
      Object.assign(combo(id), dados);
      await atualizar('combos', id, combo(id));
    } else {
      const novo = await inserir('combos', dados);
      db.combos.push(novo);
    }
    closeModal(); render(); toast('Combo salvo');
  } catch (e) { erroSync(e); }
}
async function toggleCombo(id) {
  if (!desbloqueado()) return comSenha(() => toggleCombo(id));
  const c = combo(id); c.ativo = c.ativo === false;
  try { await atualizar('combos', id, c); render(); } catch (e) { c.ativo = c.ativo === false; erroSync(e); }
}
function excluirCombo(id) {
  if (!desbloqueado()) return comSenha(() => excluirCombo(id));
  confirmar(`Excluir o combo <strong>${esc(combo(id).nome)}</strong>?`, async () => {
    try {
      await remover('combos', id);
      db.combos = db.combos.filter((x) => Number(x.id) !== Number(id));
      render(); toast('Combo excluído');
    } catch (e) { erroSync(e); }
  }, { okLabel: 'Excluir' });
}

// =====================================================================
// BARBEIROS
// =====================================================================
function modalBarbeiro(id) {
  if (!desbloqueado()) return comSenha(() => modalBarbeiro(id));
  const b = id ? barbeiro(id) : { nome: '', telefone: '', ativo: true };
  openModal({
    title: id ? 'Editar barbeiro' : 'Novo barbeiro',
    body: `<div class="form-grid">
      ${field('Nome *', `<input name="nome" value="${esc(b.nome)}">`, true)}
      ${field('Telefone', `<input name="telefone" value="${esc(b.telefone)}">`)}
      ${field('Comissão padrão (%)', `<input type="number" name="comissao" min="0" max="100" step="0.5" value="${b.comissao ?? 0}">`)}
      ${field(id ? 'Nova senha (deixe em branco para manter)' : 'Senha de acesso * (mín. 4)', `<input type="password" name="senha" autocomplete="new-password">`)}
      ${field('Repetir senha', `<input type="password" name="rep" autocomplete="new-password">`)}
      <div class="field full"><label class="check"><input type="checkbox" name="ativo" ${b.ativo !== false ? 'checked' : ''}> Barbeiro ativo (pode fazer login)</label></div>
      <p class="full muted" id="senhaErro" style="margin:0"></p>
    </div>`,
    foot: `<button class="btn" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" id="barbOk">Salvar</button>`,
    onOpen() {
      document.getElementById('barbOk').onclick = async () => {
        const f = formData(), err = document.getElementById('senhaErro'); err.style.color = 'var(--danger)';
        if (!f.nome) return (err.textContent = 'Informe o nome.');
        if (!id && f.senha.length < 4) return (err.textContent = 'A senha precisa ter pelo menos 4 caracteres.');
        if (f.senha && f.senha.length < 4) return (err.textContent = 'A senha precisa ter pelo menos 4 caracteres.');
        if (f.senha !== f.rep) return (err.textContent = 'As senhas não conferem.');
        const dados = { nome: f.nome, telefone: f.telefone, ativo: f.ativo, comissao: Number(f.comissao) || 0 };
        if (f.senha) dados.senhaHash = hashSenha(f.senha);
        try {
          if (id) {
            Object.assign(barbeiro(id), dados);
            await atualizar('barbeiros', id, barbeiro(id));
          } else {
            const novo = await inserir('barbeiros', dados);
            db.barbeiros.push(novo);
          }
          closeModal(); render(); toast('Barbeiro salvo');
        } catch (e) { erroSync(e); }
      };
    },
  });
}
function excluirBarbeiro(id) {
  if (!desbloqueado()) return comSenha(() => excluirBarbeiro(id));
  const b = barbeiro(id);
  confirmar(`Excluir o barbeiro <strong>${esc(b.nome)}</strong>? Os atendimentos dele continuam no histórico.`, async () => {
    try {
      for (const a of db.atendimentos.filter((x) => Number(x.barbeiroId) === Number(id))) {
        a.barbeiroNome = b.nome;
        await atualizar('atendimentos', a.id, a);
      }
      for (const ag of db.agendamentos.filter((x) => Number(x.barbeiroId) === Number(id))) {
        ag.barbeiroId = null;
        await atualizar('agendamentos', ag.id, ag);
      }
      await remover('barbeiros', id);
      db.barbeiros = db.barbeiros.filter((x) => Number(x.id) !== Number(id));
      render(); toast('Barbeiro excluído');
    } catch (e) { erroSync(e); }
  }, { okLabel: 'Excluir' });
}

// =====================================================================
// GERENTES (MULTI-USUÁRIO)
// =====================================================================
function modalGerente(id) {
  const g = id ? gerente(id) : { nome: '', ativo: true };
  openModal({
    title: id ? 'Editar gerente' : 'Novo gerente',
    body: `<div class="form-grid">
      ${field('Nome *', `<input name="nome" value="${esc(g.nome)}">`, true)}
      ${field(id ? 'Nova senha (deixe em branco para manter)' : 'Senha * (mín. 4)', 
        `<input type="password" name="senha" autocomplete="new-password">`, true)}
      ${field('Repetir senha', `<input type="password" name="rep" autocomplete="new-password">`, true)}
      <div class="field full"><label class="check">
        <input type="checkbox" name="ativo" ${g.ativo !== false ? 'checked' : ''}> Ativo
      </label></div>
      <p class="full muted" id="gerSenhaErro" style="margin:0"></p>
    </div>`,
    foot: `<button class="btn" onclick="closeModal()">Cancelar</button>
           <button class="btn btn-primary" id="gerOk">Salvar</button>`,
    onOpen() {
      document.getElementById('gerOk').onclick = async () => {
        const f = formData(), err = document.getElementById('gerSenhaErro');
        err.style.color = 'var(--danger)';
        if (!f.nome) return (err.textContent = 'Informe o nome.');
        if (!id && f.senha.length < 4) return (err.textContent = 'Senha mínima de 4 caracteres.');
        if (f.senha && f.senha.length < 4) return (err.textContent = 'Senha mínima de 4 caracteres.');
        if (f.senha !== f.rep) return (err.textContent = 'As senhas não conferem.');
        
        const dados = { nome: f.nome, ativo: f.ativo };
        if (f.senha) dados.senhaHash = hashSenha(f.senha);
        
        try {
          if (id) {
            Object.assign(gerente(id), dados);
            await atualizar('usuarios_gerencia', id, gerente(id));
          } else {
            const novo = await inserir('usuarios_gerencia', dados);
            db.gerencia.push(novo);
          }
          closeModal(); render(); toast('Gerente salvo');
        } catch (e) { erroSync(e); }
      };
    },
  });
}

async function excluirGerente(id) {
  if (db.gerencia.length <= 1) return toast('É necessário manter pelo menos um gerente.');
  const g = gerente(id);
  confirmar(`Excluir o gerente <strong>${esc(g.nome)}</strong>?`, async () => {
    try {
      await remover('usuarios_gerencia', id);
      db.gerencia = db.gerencia.filter(x => Number(x.id) !== Number(id));
      render(); toast('Gerente excluído');
    } catch (e) { erroSync(e); }
  }, { okLabel: 'Excluir' });
}

// =====================================================================
// BACKUP
// =====================================================================
function exportarBackup() {
  const blob = new Blob([JSON.stringify({ app: 'sparta-barbearia', versao: 3, exportadoEm: new Date().toISOString(), dados: db }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `backup-sparta-${hojeISO()}.json`;
  a.click(); URL.revokeObjectURL(a.href);
  toast('Backup gerado');
}
function importarBackup(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    let obj;
    try { obj = JSON.parse(reader.result); } catch { e.target.value = ''; return toast('Arquivo inválido: não é um JSON.'); }
    const dados = obj?.dados || obj;
    if (!dados || !Array.isArray(dados.servicos) || !Array.isArray(dados.clientes)) { e.target.value = ''; return toast('Arquivo inválido: não é um backup deste sistema.'); }
    comSenha(() => confirmar(`Substituir <strong>todos os dados atuais</strong> pelo backup?<br><br>Backup contém: ${dados.clientes.length} clientes, ${dados.servicos.length} serviços, ${(dados.atendimentos || []).length} atendimentos, ${(dados.caixa || []).length} lançamentos, ${(dados.produtos || []).length} produtos.<br><br>Esta ação não pode ser desfeita.`, async () => {
      try {
        // limpa tabelas
        for (const t of ['estoque_mov', 'produtos', 'caixa', 'atendimentos', 'agendamentos', 'combos', 'barbeiros', 'clientes', 'servicos', 'usuarios_gerencia']) {
          await supabaseClient.from(t).delete().neq('id', 0);
        }
        // reinsere
        for (const s of dados.servicos) await inserir('servicos', s);
        for (const c of dados.clientes) await inserir('clientes', c);
        for (const b of dados.barbeiros) await inserir('barbeiros', b);
        for (const g of dados.gerencia || []) await inserir('usuarios_gerencia', g);
        for (const c of dados.combos || []) await inserir('combos', c);
        for (const a of dados.agendamentos || []) await inserir('agendamentos', a);
        for (const a of dados.atendimentos || []) await inserir('atendimentos', a);
        for (const l of dados.caixa || []) await inserir('caixa', l);
        for (const p of dados.produtos || []) await inserir('produtos', p);
        if (dados.config?.senhaHash) { db.config = { id: 1, senhaHash: dados.config.senhaHash }; await salvarConfig(); }
        await recarregar();
        navigate('dashboard'); toast('Backup restaurado');
      } catch (err) { erroSync(err); }
    }, { okLabel: 'Substituir dados' }));
    e.target.value = '';
  };
  reader.readAsText(file);
}
function resetarDados() {
  comSenha(() => confirmar('Apagar <strong>todos</strong> os dados e recriar os dados de teste? Faça um backup antes, se precisar.', async () => {
    try {
      for (const t of ['estoque_mov', 'produtos', 'caixa', 'atendimentos', 'agendamentos', 'combos', 'barbeiros', 'clientes', 'servicos', 'usuarios_gerencia']) {
        await supabaseClient.from(t).delete().neq('id', 0);
      }
      await seed();
      await recarregar();
      navigate('dashboard'); toast('Dados reiniciados');
    } catch (e) { erroSync(e); }
  }, { okLabel: 'Apagar tudo' }));
}

// =====================================================================
// NAVEGAÇÃO / INICIALIZAÇÃO
// =====================================================================
document.querySelectorAll('.nav-item').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); location.hash = a.dataset.view; }));
window.addEventListener('hashchange', () => navigate(location.hash.slice(1)));
// O menu lateral informa seu estado ao leitor de tela por aria-expanded.
function menuLateral(abrir) {
  document.getElementById('sidebar').classList.toggle('open', abrir);
  document.getElementById('overlay').classList.toggle('show', abrir);
  document.getElementById('btnMenu').setAttribute('aria-expanded', String(abrir));
}
document.getElementById('btnMenu').onclick = () => menuLateral(!document.getElementById('sidebar').classList.contains('open'));
document.getElementById('overlay').onclick = () => menuLateral(false);
document.getElementById('brandLogo').innerHTML = LOGO_SVG;
document.getElementById('btnSair').onclick = sair;

// Sincronização em tempo real entre dispositivos/abas
function iniciarRealtime() {
  supabaseClient.channel('sparta-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'servicos' }, () => recarregarERender())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'clientes' }, () => recarregarERender())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'agendamentos' }, () => recarregarERender())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'atendimentos' }, () => recarregarERender())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'caixa' }, () => recarregarERender())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'combos' }, () => recarregarERender())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'barbeiros' }, () => recarregarERender())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'usuarios_gerencia' }, () => recarregarERender())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'produtos' }, () => recarregarERender())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'estoque_mov' }, () => recarregarERender())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'contagens' }, () => recarregarERender())
    .subscribe();
}
let _renderTimer = null;
function recarregarERender() {
  clearTimeout(_renderTimer);
  _renderTimer = setTimeout(async () => {
    try { await recarregar(); if (perfil) render(); } catch (e) { console.error(e); }
  }, 400);
}

// Inicialização assíncrona
(async () => {
  try {
    await carregarDados();
    iniciarRealtime();
    aplicarPerfil();
    if (perfil) navigate(location.hash.slice(1) || telaInicial());
  } catch (e) {
    console.error('Falha na inicialização', e);
  }
})();