-- =====================================================================
-- SPARTA BARBEARIA — atendimento com VÁRIOS ITENS (serviços + produtos)
-- Rode uma única vez no Supabase:
--   Dashboard → SQL Editor → New query → cole tudo → RUN
-- Nada é apagado: apenas colunas novas são adicionadas à tabela
-- atendimentos. Os atendimentos antigos continuam funcionando.
-- =====================================================================

alter table public.atendimentos
  add column if not exists "itens"         jsonb   default '[]'::jsonb,
  add column if not exists "valorServicos" numeric default 0,
  add column if not exists "valorProdutos" numeric default 0,
  add column if not exists "baseComissao"  numeric;

-- Preenche os atendimentos já existentes: tudo que havia era serviço.
update public.atendimentos
   set "valorServicos" = coalesce("valorServicos", 0) + coalesce(valor, 0),
       "valorProdutos" = coalesce("valorProdutos", 0),
       "baseComissao"  = coalesce("baseComissao", "valorFinal")
 where "baseComissao" is null;

comment on column public.atendimentos."itens" is
  'Lista de itens do atendimento: [{tipo:servico|combo|produto, id, nome, qtd, valorUnit, total}]';
comment on column public.atendimentos."baseComissao" is
  'Valor sobre o qual a comissão do barbeiro é calculada (serviços, já descontado)';
