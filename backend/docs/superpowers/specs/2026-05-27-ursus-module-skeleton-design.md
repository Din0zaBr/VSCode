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

Adopts the existing PixErase-aligned, role-based layout already implied by `.importlinter`
(three runnable apps; role modules under each layer), **plus** bounded-context subpackages
inside each layer and independence contracts so contexts cannot import each other.

```
src/ursus/
  domain/
    common/                 Entity, AggregateRoot, ValueObject, DomainEvent, EntityId, rule/exception bases
    operator/ observed_entity/ incident/ metrics/      # context domains, zero infra imports
  application/
    common/ports/           UnitOfWork, IntegrationEventPublisher, OutboxStore, InboxStore, CurrentOperator
    commands/<ctx>/         command interactors (e.g. commands/incident/raise_incident.py)
    queries/<ctx>/          query interactors (read-model reads)
                            # integration-event handlers are command interactors invoked by consumer_app
  infrastructure/
    adapters/<ctx>/         repositories + projections (implement application ports)
    event_bus/              RabbitMQ/taskiq publish + consume, event (de)serialization (adaptix)
    mappers/                ORM <-> domain mappers
    persistence/
      models/<ctx>/         SQLAlchemy ORM models (incl. outbox / inbox tables)
      migrations/           Alembic
    run_lifecycle/          startup/shutdown wiring; DuckDB / MinIO / Elastic / Keycloak clients; structlog
  presentation/
    common/                 dishka integration, CurrentOperator security dependency, error handlers
    <ctx>/                  routers + request/response schemas
  setup/                    composition root: dishka providers, settings
  http_app.py               FastAPI entrypoint (HTTP API)
  consumer_app.py           taskiq RabbitMQ consumer entrypoint (event handlers / projections)
  scheduler_app.py          taskiq scheduler entrypoint (outbox relays + Metrics threshold eval)
```

The three apps map onto the event-driven model: **http_app** serves the API, **consumer_app**
runs RabbitMQ event handlers (projections + inbox-dedupe), **scheduler_app** runs the periodic
outbox relays and the Metrics threshold evaluator.

### import-linter contracts (boundaries made real)

1. **Layered** (existing): `presentation` → `application` → `domain`. Infrastructure depends on
   application/domain but nothing depends on it inward.
2. **Protected modules** (existing): command/query handlers, `application.common.ports`,
   `infrastructure.adapters`, and `infrastructure.persistence.models` are importable only from
   their allowed importers (the three apps + setup + sanctioned infrastructure subpackages).
3. **Independence** (new): within each layer, the four contexts — `operator`,
   `observed_entity`, `incident`, `metrics` — are mutually independent. Declared per layer
   (`ursus.domain.*`, `ursus.application.commands.*`, `ursus.application.queries.*`,
   `ursus.infrastructure.adapters.*`, `ursus.infrastructure.persistence.models.*`,
   `ursus.presentation.*`). This is how "modules never import each other" is enforced.

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

## E. Shared kernel & cross-cutting modules

- `domain/common`: `Entity`, `AggregateRoot`, `ValueObject`, `DomainEvent` base, `EntityId`
  / typed id helpers, domain rule & exception bases.
- `application/common/ports`: `UnitOfWork`, `IntegrationEventPublisher`, `OutboxStore`,
  `InboxStore`, `CurrentOperator` provider — plus the `Interactor` base and result/DTO bases.
- `infrastructure/event_bus`: RabbitMQ/taskiq broker setup, publish + consume,
  integration-event (de)serialization (adaptix).
- `infrastructure/persistence`: SQLAlchemy declarative `Base` + async engine/session factory,
  `SqlAlchemyUnitOfWork`, `models/` (incl. outbox/inbox tables), Alembic `migrations/`.
- `infrastructure/run_lifecycle`: startup/shutdown wiring; Keycloak JWKS validator; DuckDB /
  MinIO / Elasticsearch clients; structlog configuration.
- `presentation/common`: dishka–FastAPI integration, `CurrentOperator` security dependency,
  exception handlers, middleware.
- `setup/`: composition root — dishka providers, settings (env).
- `http_app.py` / `consumer_app.py` / `scheduler_app.py`: the three process entrypoints.

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
