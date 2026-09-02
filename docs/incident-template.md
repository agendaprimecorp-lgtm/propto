# Modelo de Resposta a Incidente de Segurança / Privacidade

Referência: [SECURITY §12](./SECURITY.md). Preencher durante o incidente, não depois.

---

## 1. Identificação

| Campo | Valor |
|---|---|
| ID do incidente | `INC-AAAA-MM-DD-NN` |
| Detectado em (data/hora BRT) | |
| Detectado por | |
| Comunicado ao Encarregado (DPO) em | |
| Severidade | P0 (dado vazado / indisponibilidade total) · P1 (risco contido) · P2 (sem exposição) |
| Status | Contenção · Investigação · Correção · Encerrado |

## 2. Descrição objetiva

O que aconteceu, em três frases, sem hipótese e sem culpado.

## 3. Contenção (o que já foi feito)

- [ ] Chave revogada: `___________`
- [ ] Worker/serviço suspenso: `___________`
- [ ] Organização isolada: `___________`
- [ ] Rota desativada: `___________`
- [ ] Backup preservado para perícia (não sobrescrever)

Horário de cada ação:

## 4. Alcance

| Pergunta | Resposta |
|---|---|
| Quais tabelas/buckets foram atingidos? | |
| Quantas organizações? | |
| Quantos titulares de dados? | |
| Que categorias de dado? (identificação, contato, financeiro, imagem, áudio) | |
| Houve acesso efetivo ou apenas exposição possível? | |
| Evidência (consulta em `audit_log`, log do gateway, log do Storage) | |

## 5. Causa raiz

Cinco porquês. Termina em processo ou sistema, nunca em pessoa.

## 6. Notificação (LGPD art. 48)

| Item | Valor |
|---|---|
| Notificação à ANPD necessária? | Sim / Não — justificar |
| Data da comunicação à ANPD | |
| Titulares precisam ser comunicados? | Sim / Não — justificar |
| Canal e data da comunicação aos titulares | |
| Texto enviado (anexar) | |

**Comunicar quando houver risco ou dano relevante aos titulares.** Na dúvida, comunicar.

## 7. Correção

| Ação | Responsável | Prazo | Status |
|---|---|---|---|
| Correção do código | | | |
| Teste de regressão adicionado | | | |
| Novo caso na suíte `tests/rls/` ou `tests/ai/` | | | |
| Verificação em produção | | | |

## 8. Prevenção

O que muda no processo para este incidente não se repetir? Cada item vira história no `BACKLOG.md` com ID.

## 9. Linha do tempo

| Horário | Evento |
|---|---|
| | |

## 10. Post-mortem

Realizado em: ______ · Participantes: ______

Sem culpado. O objetivo é o sistema, não a pessoa.
