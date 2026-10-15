-- =====================================================================
-- SPARTA BARBEARIA — tabelas de ESTOQUE DE PRODUTOS
-- Rode este script uma única vez no Supabase:
--   Dashboard → SQL Editor → New query → cole tudo → RUN
-- Os nomes das colunas usam aspas para manter o padrão camelCase
-- já utilizado pelas outras tabelas do sistema.
-- =====================================================================

-- ---------- PRODUTOS ----------
create table if not exists public.produtos (
  id            bigint generated always as identity primary key,
  nome          text    not null,
  categoria     text,
  unidade       text    default 'un',
  custo         numeric default 0,      -- quanto a barbearia paga
  preco         numeric default 0,      -- quanto o cliente paga
  estoque       numeric default 0,      -- quantidade atual
  "estoqueMin"  numeric default 0,      -- alerta quando chegar nesse nível
  ativo         boolean default true,
  obs           text,
  "criadoEm"    timestamptz default now()
);

-- ---------- MOVIMENTAÇÕES DE ESTOQUE ----------
-- Cada entrada, venda, baixa ou ajuste vira uma linha aqui.
create table if not exists public.estoque_mov (
  id            bigint generated always as identity primary key,
  "produtoId"   bigint references public.produtos(id) on delete cascade,
  "produtoNome" text,                   -- guardado para o histórico sobreviver à exclusão
  tipo          text    not null,       -- entrada | venda | baixa | ajuste
  quantidade    numeric not null,       -- sempre positiva
  saldo         numeric,                -- estoque resultante após a movimentação
  "valorUnit"   numeric default 0,
  total         numeric default 0,
  motivo        text,
  data          date    default current_date,
  "usuarioNome" text,
  "caixaId"     bigint,                 -- lançamento gerado no caixa, quando houver
  "criadoEm"    timestamptz default now()
);

create index if not exists estoque_mov_produto_idx on public.estoque_mov ("produtoId");
create index if not exists estoque_mov_data_idx    on public.estoque_mov (data);

-- ---------- ACESSO ----------
-- Mesma configuração das demais tabelas do sistema: o acesso é controlado
-- pelo login da aplicação, então a chave pública pode ler e gravar.
alter table public.produtos     enable row level security;
alter table public.estoque_mov  enable row level security;

drop policy if exists "acesso_total_produtos" on public.produtos;
create policy "acesso_total_produtos" on public.produtos
  for all using (true) with check (true);

drop policy if exists "acesso_total_estoque_mov" on public.estoque_mov;
create policy "acesso_total_estoque_mov" on public.estoque_mov
  for all using (true) with check (true);

-- ---------- SINCRONIZAÇÃO EM TEMPO REAL ----------
-- Faz o estoque atualizar sozinho em todos os aparelhos abertos.
alter publication supabase_realtime add table public.produtos;
alter publication supabase_realtime add table public.estoque_mov;
