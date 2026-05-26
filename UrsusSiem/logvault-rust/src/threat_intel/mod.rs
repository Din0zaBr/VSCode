//! Threat Intelligence subsystem.
//!
//! Pulls IOC feeds from public sources, keeps them in compact in-memory
//! structures (bloom-filter for IPs/URLs, hash-set for file hashes), and
//! exposes a `match` API for the pipeline to tag/boost events.
//!
//! Refresh cadence is driven by the Go scheduler (logvault-go/internal/jobs/);
//! this module owns parsing + storage + lookup. It is intentionally
//! synchronous and lock-free during the hot path (Arc<Snapshot>).

pub mod bloom;
pub mod feeds;
pub mod lookup;

#[cfg(test)]
mod bloom_tests;

pub use bloom::Bloom;
pub use feeds::{FeedKind, FetchRequest, FetchResponse, IocBatch};
pub use lookup::{LookupRequest, LookupResponse, LookupResult};
