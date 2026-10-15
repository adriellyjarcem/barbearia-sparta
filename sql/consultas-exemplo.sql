-- =====================================================================
-- SPARTA BARBEARIA — CONSULTAS DE EXEMPLO
--
-- Este arquivo NÃO faz parte das migrações: serve para conferir o
-- esquema em um banco de testes. Ele insere alguns registros fictícios,
-- executa as consultas que alimentam os relatórios do sistema e, ao
-- final, verifica o comportamento das chaves estrangeiras.
--
-- Como usar em um PostgreSQL local, em banco vazio:
--   psql -f sql/00-schema.sql -f sql/01-estoque.sql \
--        -f sql/02-atendimento-itens.sql -f sql/03-contagens.sql \
--        -f sql/consultas-exemplo.sql
--
-- NÃO execute no banco de produção: ele grava e apaga registros.
-- =====================================================================

\pset border 2
-- ============ INSERÇÃO ============
insert into clientes (nome, telefone) values
  ('João Silva','(67) 99911-1111'), ('Pedro Santos','(67) 99922-2222');
insert into servicos (nome, categoria, duracao, valor) values
  ('Corte','Cabelo',30,45), ('Barba','Barba',20,35);
insert into barbeiros (nome, comissao, "senhaHash") values
  ('Barbeiro 1',40,'a1b2c3'), ('Barbeiro 2',40,'d4e5f6');
insert into produtos (nome, categoria, custo, preco, estoque, "estoqueMin") values
  ('Pomada modeladora 120g','Pomada / Gel',18,35,12,4),
  ('Óleo para barba 30ml','Barba',14,30,3,4);

insert into atendimentos ("clienteId","clienteNome","servicoId",descricao,"barbeiroId","barbeiroNome",
                          data,hora,valor,desconto,"valorFinal",pagamento,
                          itens,"valorServicos","valorProdutos","baseComissao")
values
 (1,'João Silva',1,'Corte',1,'Barbeiro 1','2026-10-10','09:00',45,0,45,'pix',
  '[{"tipo":"servico","id":1,"nome":"Corte","qtd":1,"valorUnit":45,"total":45}]',45,0,45),
 (2,'Pedro Santos',2,'Barba + Pomada modeladora 120g',2,'Barbeiro 2','2026-10-10','10:15',70,5,65,'debito',
  '[{"tipo":"servico","id":2,"nome":"Barba","qtd":1,"valorUnit":35,"total":35},
    {"tipo":"produto","id":1,"nome":"Pomada modeladora 120g","qtd":1,"valorUnit":35,"total":35}]',35,35,30),
 (1,'João Silva',1,'Corte',1,'Barbeiro 1','2026-10-12','14:00',45,0,45,'dinheiro',
  '[{"tipo":"servico","id":1,"nome":"Corte","qtd":1,"valorUnit":45,"total":45}]',45,0,45);

insert into caixa (tipo,descricao,categoria,valor,data,pagamento,"atendimentoId") values
 ('entrada','Corte — João Silva','Atendimento',45,'2026-10-10','pix',1),
 ('entrada','Barba + Pomada — Pedro Santos','Atendimento',65,'2026-10-10','debito',2),
 ('entrada','Corte — João Silva','Atendimento',45,'2026-10-12','dinheiro',3),
 ('saida','Compra de lâminas','Produtos',132,'2026-10-11','debito',null);

\echo '\n===== CONSULTA 1: faturamento e despesas do período ====='
select to_char(sum(valor) filter (where tipo='entrada'),'FM999G990D00') as entradas,
       to_char(sum(valor) filter (where tipo='saida'),  'FM999G990D00') as saidas,
       to_char(sum(case when tipo='entrada' then valor else -valor end),'FM999G990D00') as resultado
  from caixa where data between '2026-10-01' and '2026-10-31';

\echo '\n===== CONSULTA 2: comissão por barbeiro no período ====='
select b.nome as barbeiro,
       count(*) as atendimentos,
       to_char(sum(a."baseComissao"),'FM999G990D00') as base,
       b.comissao || '%' as perc,
       to_char(sum(a."baseComissao") * b.comissao/100,'FM999G990D00') as a_pagar
  from atendimentos a
  join barbeiros b on b.id = a."barbeiroId"
 where a.data between '2026-10-01' and '2026-10-31'
 group by b.nome, b.comissao
 order by 5 desc;

\echo '\n===== CONSULTA 3: produtos abaixo do estoque mínimo ====='
select nome, estoque, "estoqueMin" as minimo,
       case when estoque <= "estoqueMin" then 'REPOR' else 'ok' end as situacao
  from produtos where ativo order by estoque <= "estoqueMin" desc, nome;

\echo '\n===== CONSULTA 4: itens vendidos, expandindo o JSON ====='
select i->>'nome' as item, i->>'tipo' as tipo,
       sum((i->>'qtd')::numeric) as qtd,
       to_char(sum((i->>'total')::numeric),'FM999G990D00') as total
  from atendimentos a, jsonb_array_elements(a.itens) as i
 group by 1,2 order by 4 desc;

\echo '\n===== INTEGRIDADE: excluir barbeiro preserva o histórico ====='
delete from barbeiros where id = 2;
select id, "clienteNome", "barbeiroId", "barbeiroNome", "valorFinal"
  from atendimentos where id = 2;

\echo '\n===== INTEGRIDADE: excluir atendimento remove a entrada no caixa ====='
select count(*) as caixa_antes from caixa where "atendimentoId" = 1;
delete from atendimentos where id = 1;
select count(*) as caixa_depois from caixa where "atendimentoId" = 1;
