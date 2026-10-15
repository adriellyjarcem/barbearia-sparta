-- =====================================================================
-- SPARTA BARBEARIA — CONTAGENS DE ESTOQUE COM APROVAÇÃO
-- Rode uma única vez no Supabase:
--   Dashboard → SQL Editor → New query → cole tudo → RUN
-- A contagem do barbeiro NÃO altera o saldo: fica pendente até a
-- gerência aprovar item a item ou pedir recontagem.
-- =====================================================================

create table if not exists public.contagens (
  id             bigint generated always as identity primary key,
  data           date    default current_date,
  "usuarioNome"  text,
  perfil         text,                          -- barbeiro | gerencia
  status         text    default 'pendente',    -- pendente | concluida | recontagem
  obs            text,
  itens          jsonb   default '[]'::jsonb,   -- [{produtoId, nome, esperado, contagem, diferenca, decisao}]
  "revisadoPor"  text,
  "revisadoEm"   timestamptz,
  "criadoEm"     timestamptz default now()
);

create index if not exists contagens_status_idx on public.contagens (status);

alter table public.contagens enable row level security;
drop policy if exists "acesso_total_contagens" on public.contagens;
create policy "acesso_total_contagens" on public.contagens
  for all using (true) with check (true);

alter publication supabase_realtime add table public.contagens;

comment on column public.contagens.itens is
  'esperado = saldo do sistema no momento da contagem; contagem = o que foi contado na prateleira';
