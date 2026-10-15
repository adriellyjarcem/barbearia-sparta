-- =====================================================================
-- SPARTA BARBEARIA — ESQUEMA COMPLETO DO BANCO DE DADOS
-- PostgreSQL (Supabase)
--
-- Este arquivo consolida a estrutura das tabelas do sistema, com chaves
-- primárias, chaves estrangeiras, índices e políticas de acesso.
-- Execute-o PRIMEIRO, antes das migrações numeradas a seguir:
--   Supabase → SQL Editor → New query → cole tudo → RUN
--
-- Convenção: os nomes de coluna em camelCase vão entre aspas duplas,
-- porque o PostgreSQL converte identificadores sem aspas para minúsculo.
-- =====================================================================


-- =====================================================================
-- 1. CADASTROS BÁSICOS
-- =====================================================================

-- ---------- CLIENTES ----------
create table if not exists public.clientes (
  id          bigint generated always as identity primary key,
  nome        text not null,
  telefone    text,
  obs         text,
  "criadoEm"  bigint                      -- data de cadastro em milissegundos
);

-- ---------- SERVIÇOS ----------
create table if not exists public.servicos (
  id         bigint generated always as identity primary key,
  nome       text    not null,
  categoria  text,
  duracao    integer default 30,          -- minutos, usado na agenda
  valor      numeric not null default 0,
  ativo      boolean default true         -- inativar preserva o histórico
);

-- ---------- COMBOS ----------
-- Um combo agrupa vários serviços por um preço fechado. A lista de
-- serviços fica em JSON porque é curta, sempre lida junto com o combo e
-- nunca consultada isoladamente — ver nota sobre normalização no final.
create table if not exists public.combos (
  id           bigint generated always as identity primary key,
  nome         text    not null,
  "servicoIds" jsonb   default '[]'::jsonb,
  valor        numeric not null default 0,
  ativo        boolean default true
);

-- ---------- BARBEIROS ----------
create table if not exists public.barbeiros (
  id          bigint generated always as identity primary key,
  nome        text    not null,
  telefone    text,
  comissao    numeric default 0,          -- percentual sobre os serviços
  "senhaHash" text,                       -- NUNCA a senha em texto puro
  ativo       boolean default true
);

-- ---------- USUÁRIOS DE GERÊNCIA ----------
create table if not exists public.usuarios_gerencia (
  id          bigint generated always as identity primary key,
  nome        text not null,
  "senhaHash" text,
  ativo       boolean default true
);

-- ---------- CONFIGURAÇÃO ----------
-- Linha única com a senha gerencial usada nas operações sensíveis.
create table if not exists public.config (
  id          bigint generated always as identity primary key,
  "senhaHash" text
);


-- =====================================================================
-- 2. OPERAÇÃO
-- =====================================================================

-- ---------- AGENDAMENTOS ----------
-- "servicoId" aponta para servicos OU para combos, conforme a coluna
-- "tipo". Por referenciar duas tabelas, não recebe chave estrangeira:
-- a integridade é garantida pela aplicação.
create table if not exists public.agendamentos (
  id          bigint generated always as identity primary key,
  "clienteId" bigint references public.clientes(id)  on delete cascade,
  "servicoId" bigint,
  tipo        text   default 'servico',   -- servico | combo
  "barbeiroId" bigint references public.barbeiros(id) on delete set null,
  data        date   not null,
  hora        text   not null,            -- 'HH:MM'
  status      text   default 'agendado',  -- agendado | confirmado | concluido | cancelado
  obs         text
);

create index if not exists agendamentos_data_idx    on public.agendamentos (data);
create index if not exists agendamentos_cliente_idx on public.agendamentos ("clienteId");

-- ---------- ATENDIMENTOS ----------
-- Registro do serviço efetivamente realizado. Os nomes de cliente e de
-- barbeiro são copiados para cá de propósito: o histórico precisa
-- sobreviver à exclusão do cadastro, por isso as chaves estrangeiras
-- usam ON DELETE SET NULL em vez de CASCADE.
create table if not exists public.atendimentos (
  id              bigint generated always as identity primary key,
  "clienteId"     bigint references public.clientes(id)  on delete set null,
  "clienteNome"   text,
  "servicoId"     bigint,                 -- servicos ou combos, conforme "tipo"
  tipo            text    default 'servico',
  descricao       text,                   -- resumo legível dos itens
  "barbeiroId"    bigint references public.barbeiros(id) on delete set null,
  "barbeiroNome"  text,
  data            date    not null,
  hora            text,
  valor           numeric default 0,      -- soma bruta dos itens
  desconto        numeric default 0,
  "valorFinal"    numeric default 0,      -- valor - desconto
  pagamento       text,                   -- dinheiro | pix | debito | credito
  itens           jsonb   default '[]'::jsonb,
  "valorServicos" numeric default 0,
  "valorProdutos" numeric default 0,
  "baseComissao"  numeric                 -- base de cálculo da comissão
);

create index if not exists atendimentos_data_idx     on public.atendimentos (data);
create index if not exists atendimentos_barbeiro_idx on public.atendimentos ("barbeiroId");

comment on column public.atendimentos.itens is
  'Itens do atendimento: [{tipo, id, nome, qtd, valorUnit, total}]';
comment on column public.atendimentos."baseComissao" is
  'Valor sobre o qual a comissão do barbeiro incide (serviços, já descontado)';

-- ---------- CAIXA ----------
-- Entradas nascem dos atendimentos concluídos; saídas são lançadas à mão.
-- Excluir o atendimento remove a entrada correspondente (CASCADE).
create table if not exists public.caixa (
  id              bigint generated always as identity primary key,
  tipo            text    not null,       -- entrada | saida
  descricao       text,
  categoria       text,
  valor           numeric not null default 0,
  data            date    not null,
  pagamento       text,
  "atendimentoId" bigint references public.atendimentos(id) on delete cascade
);

create index if not exists caixa_data_idx        on public.caixa (data);
create index if not exists caixa_atendimento_idx on public.caixa ("atendimentoId");


-- =====================================================================
-- 3. ACESSO E SINCRONIZAÇÃO
-- =====================================================================
-- O controle de acesso do sistema é feito na aplicação, por perfil.
-- As políticas abaixo liberam a chave publicável para ler e gravar.
-- ATENÇÃO: antes do uso com dados reais, restrinja estas políticas.
alter table public.clientes          enable row level security;
alter table public.servicos          enable row level security;
alter table public.combos            enable row level security;
alter table public.barbeiros         enable row level security;
alter table public.usuarios_gerencia enable row level security;
alter table public.config            enable row level security;
alter table public.agendamentos      enable row level security;
alter table public.atendimentos      enable row level security;
alter table public.caixa             enable row level security;

do $$
declare t text;
begin
  foreach t in array array['clientes','servicos','combos','barbeiros',
                           'usuarios_gerencia','config','agendamentos',
                           'atendimentos','caixa']
  loop
    execute format('drop policy if exists "acesso_total_%I" on public.%I', t, t);
    execute format('create policy "acesso_total_%I" on public.%I
                      for all using (true) with check (true)', t, t);
  end loop;
end $$;

-- Sincronização entre o computador da recepção e o celular da gerência.
alter publication supabase_realtime add table public.clientes;
alter publication supabase_realtime add table public.servicos;
alter publication supabase_realtime add table public.combos;
alter publication supabase_realtime add table public.barbeiros;
alter publication supabase_realtime add table public.agendamentos;
alter publication supabase_realtime add table public.atendimentos;
alter publication supabase_realtime add table public.caixa;


-- =====================================================================
-- NOTA SOBRE NORMALIZAÇÃO
-- ---------------------------------------------------------------------
-- O modelo está na 3ª forma normal nos cadastros. Há duas exceções
-- deliberadas, ambas motivadas por requisitos do negócio:
--
-- 1. Nomes copiados ("clienteNome", "barbeiroNome", "produtoNome") e
--    valores praticados no atendimento. Sem eles, excluir um cadastro ou
--    reajustar um preço reescreveria o passado: um relatório de março
--    passaria a mostrar o preço de abril. O atendimento é um documento
--    histórico, e documentos não se atualizam sozinhos.
--
-- 2. Listas em JSON ("itens" do atendimento, "servicoIds" do combo,
--    "itens" da contagem). São listas curtas, sempre lidas junto com a
--    linha que as contém e nunca consultadas isoladamente. Tabelas
--    próprias acrescentariam junções sem benefício de consulta.
-- =====================================================================
