# URSUS — Event & Persistence Contracts (Plan 2 foundations)

- **Date:** 2026-05-31
- **Status:** Approved (brainstorming → writing-plans)
- **Scope:** The cross-cutting contracts that the **persistence kernel (Plan 2)** must
  establish: domain-vs-integration events, the domain→integration mapping mechanism,
  integration-event schema versioning & serialization, the polyglot migration story, and
  the Operator-context boundary. **Not** the RabbitMQ wiring itself (exchange topology,
  routing, the concrete publisher) — that is Plan 3 (messaging kernel).

## Background

This spec resolves the four high-impact gaps surfaced after the foundation (Plan 1) landed.
They were deferred because each shapes the contracts that Plan 2 will implement. It refines —
does not replace — `2026-05-27-ursus-module-skeleton-design.md`; all skeleton decisions
(polyglot persistence, per-context read models, transactional outbox + idempotent inbox,
Metrics deterministic event-ids) remain in force and are referenced here by number (S1–S9).

## Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| E1 | Domain vs integration events | **Two distinct concepts + explicit mapping** | Domain events stay rich/internal; integration events are flat, versioned cross-context contracts. Canonical DDD; refactoring a domain event must never break a sibling context. |
| E2 | Mapping mechanism | **Translator registry living in `infrastructure/mappers/<context>/`** | One explicit translator per outward-facing domain event; `dict[type[DomainEvent], Translator]`. Domain stays ignorant of integration/transport; unregistered events stay internal. |
| E3 | Schema versioning | **`schema_version: int` in payload + tolerant readers** | Industry standard, no schema-registry service (matches "no unnecessary machinery"). Version visible in payload and logs. |
| E4 | Breaking-change strategy | **Additive-only within a version; a truly breaking change = a new event type (new routing key)** | Avoids dual-publish duplicate-delivery, which would arise from bumping the version on a single routing key (we chose payload-versioning, not routing-key-versioning). No dual-publish machinery (YAGNI). |
| E5 | (De)serialization | **adaptix `Retort`** | Integration events stay clean frozen dataclasses (no library base class), consistent with `DomainEvent` and the dishka ecosystem. Tolerant-reader via extra-field-skip policy. |
| E6 | Migrations | **Single Alembic history for Postgres-backed contexts only** | Monolith deploys atomically. DuckDB / Elasticsearch / MinIO are **not** Alembic-managed (polyglot persistence, S6). |
| E7 | Operator boundary | **Operator = identity + authZ; read models live in the data-owning context** | Consistent with per-context local read models (S3). A unified `Reporting` context is a marked seam for the future, **not** built now. |

## A. Domain events vs Integration events (E1, E2)

Two concepts, never conflated:

- **`DomainEvent`** — internal, rich (may carry value objects, reference the aggregate).
  Stays exactly as today: `frozen=True, kw_only=True` dataclass with `event_id` + `occurred_at`.
  Recorded by the aggregate via `record_event`; surfaced via `collect_events()`. **Never leaves
  the process by itself.**
- **`IntegrationEvent`** — flat, versioned DTO; the cross-context contract. Carries
  `schema_version: int`, a stable `event_id`, `occurred_at`, and primitive/flat fields only.
  Written to the outbox and (Plan 3) published to RabbitMQ.

Not every domain event becomes an integration event.

### Mapping (E2)

- For each outward-facing domain event, an explicit **translator**
  (`DomainEvent → IntegrationEvent`) lives in `infrastructure/mappers/<context>/`.
- A registry `dict[type[DomainEvent], Translator]` is the single place that answers
  "what gets published". Domain events absent from the registry stay internal.
- The domain layer does not import translators or `IntegrationEvent`; the mapping is purely
  infrastructural, so no layer/independence contract is violated (the Unit of Work
  implementation and the registry both live in infrastructure).

## B. Outbox is NOT uniform — two delivery paths

This is the key correction to avoid contradicting S6/S7. The transactional-outbox pattern
applies to Postgres-backed aggregates only; Metrics has a different path by design.

### B.1 Postgres path (Operator, Observed Entity, Incident)

- A repository **registers touched aggregates** with the Unit of Work.
- On commit, the UoW iterates the registered aggregates, runs `collect_events()` through the
  translator registry, serializes each resulting `IntegrationEvent` (adaptix), and writes it to
  the **outbox table in the same transaction** as the aggregate state. (S7: transactional outbox.)
- The integration `event_id` is **persisted once in the outbox row** — stable across publish
  retries, so the consumer-side idempotent inbox can dedupe.

### B.2 Metrics path (DuckDB)

- Metrics does **not** use a DuckDB outbox relay (S6/S7 locked this out — DuckDB is embedded,
  single-writer). `ThresholdBreached` is emitted from a scheduler job evaluating DuckDB, not
  from a UoW aggregate commit.
- Idempotency comes from a **deterministic `event_id` = hash(entity, window, threshold)** rather
  than from outbox exactly-once. Publication is at-least-once; the consumer-side **idempotent
  inbox** dedupes by that deterministic id.
- (The exact hash algorithm, field set, and stable serialization for the deterministic id are
  specified in the Metrics slice plan, not here.)

### B.3 Shared inbox

- One idempotent-inbox mechanism on the consumer side, keyed by `event_id`, serves both paths.
  Postgres-path ids are persisted-random; Metrics-path ids are deterministic-hash — both stable.

## C. Ports established by Plan 2

In `application/common/ports/` (currently empty), with infrastructure implementations:

- **`UnitOfWork`** — transaction boundary; tracks registered aggregates; on commit runs
  collect→translate→serialize→outbox-write (Postgres path).
- **`OutboxStore`** — appends a serialized `IntegrationEvent` to the outbox within the active
  transaction. (Postgres path contract; Metrics does not use it.)
- **`IntegrationEventPublisher`** — publish port. **Contract only** in Plan 2; the RabbitMQ
  implementation, exchange topology, and routing keys are Plan 3.
- **Idempotent inbox** — dedupe-by-`event_id` contract for consumers.

## D. Migration / schema-init story (E6) — polyglot

| Store | Contexts | Schema management |
|-------|----------|-------------------|
| Postgres | Operator, Observed Entity, Incident | **Alembic** — single linear history, one `alembic_version` in a service schema, each revision addresses its own schema (`op.create_table(..., schema="incident")`), `include_schemas=True`, `target_metadata` aggregates the **Postgres** contexts' ORM models only. |
| DuckDB | Metrics | DuckDB DDL at startup/init — **not** Alembic. |
| Elasticsearch | search projections | Index templates / mappings init — **not** Alembic. |
| MinIO | blobs | Bucket init — **not** Alembic. |

"Single Alembic history" therefore means *single history across the Postgres-backed contexts*,
not across the whole monolith. This is deliberate and demonstrates the limits of the
outbox/Alembic patterns on embedded/non-relational stores.

## E. Operator boundary (E7)

- Operator = identity + authorization (Keycloak authN, `CurrentOperator`, JIT provisioning,
  role mapping).
- Read models default to the **data-owning context** (consistent with S3 per-context read models).
- A unified `Reporting`/`Dashboard` context is a **marked seam**, not built in Plan 2.
  Cross-context dashboard composition (API gateway / BFF) is a separate, later decision.

## F. Scope boundary: Plan 2 vs Plan 3

- **Plan 2 (persistence kernel) fixes:** `IntegrationEvent` shape + `schema_version`,
  adaptix (de)serialization, the translator-registry mechanism, `UnitOfWork`, `OutboxStore`,
  the idempotent-inbox contract, and the polyglot migration story above.
- **Plan 3 (messaging kernel) fixes:** RabbitMQ exchange topology, routing keys
  (`<context>.<event_type>`, topic exchange), the concrete `IntegrationEventPublisher`,
  the outbox relay/poller, retry/DLQ.

The versioning/serialization *contract* is settled now (not deferred to Plan 3) only because
the outbox stores the already-serialized integration event.

## Non-goals

- RabbitMQ wiring (Plan 3).
- The Metrics deterministic-id hash specification (Metrics slice plan).
- A `Reporting` context (future seam only).
- Dual-publish / multi-version-on-one-routing-key machinery (explicitly rejected, E4).
