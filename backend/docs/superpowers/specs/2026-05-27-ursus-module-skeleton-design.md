# URSUS — Module Skeleton Design

- **Date:** 2026-05-27
- **Status:** Approved (brainstorming → writing-plans)
- **Scope:** Architectural skeleton and cross-cutting infrastructure of the URSUS monolith. **Not** full domain logic.

## Background

URSUS is a monitoring / SIEM backend, built as a graduation-diploma project. It is a
**modular monolith** designed with **Domain-Driven Design** and developed with **TDD**.
Each bounded context is a module with a **Clean Architecture** layering (dependencies point
inward: presentation → application → domain; infrastructure implements application ports).

Stack (already declared in `pyproject.toml`): Python 3.13, FastAPI, dishka (DI),
SQLAlchemy async + Alembic, DuckDB, taskiq, structlog, adaptix; testcontainers
(Postgres/MinIO/Elasticsearch) + pika for tests; ruff, mypy, import-linter, bandit.

## Goals

- Establish the module boundaries and the cross-cutting infrastructure that every
  context will reuse, proven end-to-end by a **walking skeleton**.
- Make the boundaries *enforced*, not merely documented (import-linter contracts).
- Develop with TDD throughout.

## Non-goals

- Full domain modelling of any single context (aggregates, full invariants, all use cases).
- GeoIP ingestion for the Observed Entity geo invariant (its own later slice).
- Gateway (Kong/Traefik) configuration — the app validates tokens itself (see Auth).

## Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Bounded contexts | **Operator · Observed Entity · Incident · Metrics** | The domain vocabulary: persona who observes, persona observed, the incident, grouped numeric metrics. |
| 2 | Inter-module comms | **Event-driven only** — no module imports a sibling | Maximum decoupling; matches the SIEM event-driven nature; enforceable by import-linter. |
| 3 | Cross-context reads | **Per-context local read models** (event-carried state transfer) | No synchronous cross-context queries; each context projects what it needs from events. Airtight boundaries, CQRS story. |
| 4 | Event transport | **RabbitMQ** via taskiq (`taskiq-aio-pika`) | Real broker; `pika` already in test deps; taskiq already in deps. |
| 5 | Code layout | **Layer-first** (`{domain,application,infrastructure,presentation}/<context>/`) + `common` per layer | Keeps the existing scaffold and PixErase reference; boundaries enforced via independence + layered contracts. |
| 6 | Persistence | **Polyglot by purpose** | Postgres (schema/context) for transactional contexts; DuckDB for Metrics; Elasticsearch for search projections; MinIO for blobs. Uses every declared dependency. |
| 7 | Delivery reliability | **Transactional outbox + idempotent inbox** | Solves the dual-write problem; at-least-once delivery with effectively-once processing. |
| 8 | Application layer | **Direct interactor classes** (dishka-injected) | Simplest, most explicit call path; cross-cutting (UoW txn, outbox flush, logging) via decorators / interactor base. |
| 9 | Authentication | **Keycloak** IdP; app validates JWT via JWKS | No credential code in the app; ready-made IdP; JIT operator provisioning from claims. |

## A. Context map & ownership

```
                    ┌──────────────────────────┐
                    │   Operator (Analyst)      │  authZ + profile
                    │   JIT-provisioned from JWT │  (Keycloak = authN)
                    └───────────┬───────────────┘
                                │ OperatorAssigned / OperatorUpdated
                                ▼
   ┌───────────────┐     ┌─────────────┐
   │ Observed      │     │  Incident   │  raised → triaged → resolved
   │ Entity (asset)│────▶│             │  owns lifecycle invariants
   │ geo invariant │     │             │
   └──────┬────────┘     └──────▲──────┘
          │ EntityRegistered    │ ThresholdBreached → raises incident
          ▼                     │
   ┌───────────────┐            │
   │  Metrics      │────────────┘  invariant: counts ≥ 0
   │ (DuckDB)      │
   └───────────────┘
```

Each context owns its write model **and** local read-model projections of the other
contexts' data it needs (e.g. Incident keeps `operator_read_model` and
`observed_entity_read_model`, fed by events — it never queries those contexts).

## B. Code structure

```
src/ursus/
  domain/
    common/        Entity, AggregateRoot, ValueObject, DomainEvent, EntityId, rule/exception bases
    operator/  observed_entity/  incident/  metrics/        # pure domain, zero infra imports
  application/
    common/        Interactor base, UnitOfWork port, IntegrationEventPublisher port,
                   OutboxStore / InboxStore ports, CurrentOperator port
    operator/  observed_entity/  incident/  metrics/        # interactors, command DTOs, event handlers, ports
  infrastructure/
    common/        SQLAlchemy Base, async session/UoW, outbox table+relay, inbox+dedupe,
                   RabbitMQ/taskiq broker, event (de)serialization (adaptix),
                   Keycloak JWKS validator, DuckDB / MinIO / Elastic clients, structlog
    operator/  observed_entity/  incident/  metrics/        # repos, ORM models, projections, migrations
  presentation/
    common/        FastAPI app factory, dishka integration, CurrentOperator security dep, error handlers
    operator/  observed_entity/  incident/  metrics/        # routers, request/response schemas
  setup/           composition root: dishka providers, settings, FastAPI app + taskiq worker entrypoints
```

### import-linter contracts (boundaries made real)

1. **Layered** (within `ursus`): `presentation` → `application` → `domain`;
   `infrastructure` may depend on `application`/`domain` but nothing depends on it inward.
   `domain` imports neither application, infrastructure, nor presentation.
   The per-layer `common` package is the only shared dependency.
2. **Independence** (per layer): `operator`, `observed_entity`, `incident`, `metrics`
   are mutually independent — no context may import a sibling context in any layer.
   This is how "modules never import each other" is enforced on a layer-first tree.

## C. Runtime flow & reliability

Worked example (metric breach → incident):

```
1. Agent posts metrics → Metrics.IngestMetric interactor → append to DuckDB
2. Metrics threshold-eval (taskiq periodic) detects breach
       → emits ThresholdBreached  (deterministic event id = hash(entity, window, threshold))
3. RabbitMQ → Incident's taskiq consumer
       → inbox dedupe (skip if seen) → RaiseIncident interactor
       → BEGIN  incident write + outbox row  COMMIT
4. Incident outbox relay (taskiq periodic) → publishes IncidentRaised → RabbitMQ
5. Operator's projection consumer updates its incident read model for dashboards
```

**Outbox / inbox:**
- Postgres contexts (Operator, Observed Entity, Incident): classic in-transaction
  **outbox** table + a per-context **relay** (taskiq periodic) that publishes unsent
  rows to RabbitMQ and marks them sent. Consumers maintain an **inbox** table for dedupe.
- **Outbox asymmetry (decision):** the Metrics context is append-heavy on DuckDB, so its
  threshold events use **deterministic event IDs + idempotent inbox on the consumer**
  rather than a DuckDB outbox relay. Re-runs of the evaluator therefore dedupe cleanly.

## D. Authentication (Keycloak)

Keycloak owns login / passwords / token issuance & refresh / user federation. The app
**never** handles credentials.

- A FastAPI security dependency validates the Bearer JWT against Keycloak's cached JWKS
  and builds `CurrentOperator(sub, roles, email)`.
- First authenticated request **JIT-provisions** a local Operator profile from the claims.
- The Operator context maps Keycloak realm/client roles → URSUS permissions (authorization).

## E. Shared kernel (per-layer `common`)

- `domain/common`: `Entity`, `AggregateRoot`, `ValueObject`, `DomainEvent` base, `EntityId`
  / typed id helpers, domain rule & exception bases.
- `application/common`: `Interactor` base, `UnitOfWork` port, `IntegrationEventPublisher`
  port, `OutboxStore` / `InboxStore` ports, `CurrentOperator` provider port, result/DTO bases.
- `infrastructure/common`: SQLAlchemy declarative `Base` + async engine/session factory,
  `SqlAlchemyUnitOfWork`, outbox table + relay, inbox table + dedupe, RabbitMQ/taskiq broker
  setup, integration-event (de)serialization (adaptix), Keycloak JWKS validator, DuckDB /
  MinIO / Elasticsearch clients, structlog configuration.
- `presentation/common`: FastAPI app factory, dishka–FastAPI integration, `CurrentOperator`
  security dependency, exception handlers, middleware.
- `setup/`: composition root — dishka providers, settings (env), FastAPI app + taskiq worker
  entrypoints.

## F. First implementation target — walking skeleton

A single thin end-to-end slice that exercises the whole architecture before any context is
fleshed out: **metric ingest → `ThresholdBreached` → incident raised → projection updated**,
behind the Keycloak security dependency. It must drive: the event bus, an outbox + relay,
an inbox + dedupe, a UoW, a read-model projection, and JWT validation. When it works, the
architecture is proven.

## G. Testing & tooling

- **Unit tests**: domain invariants, no IO (e.g. metric count ≥ 0; incident lifecycle states).
- **Integration tests**: per adapter via testcontainers — Postgres (repos/UoW/outbox/inbox),
  RabbitMQ (publish/consume), MinIO, Elasticsearch.
- **Architecture tests**: import-linter contracts run in CI.
- **Static**: ruff (format + lint), mypy (fully typed), bandit.
- TDD: a failing test precedes each unit of behaviour.

## Risks / open questions

- DuckDB single-writer characteristics under concurrent ingest + evaluation — validate in
  the walking skeleton.
- Deterministic event-ID scheme for Metrics must be stable across evaluator re-runs.
- Keycloak realm-role → URSUS permission mapping needs a concrete convention (later slice).
