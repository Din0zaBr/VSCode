//! A minimal Bloom-filter for IOC lookups.
//!
//! `m` bits, `k` hash functions. We use FNV-1a + a second seeded hash
//! (Wang) — good enough for IOC sets in the 100K–10M range with single-
//! digit-percent false-positive rate. No external crate required.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Bloom {
    bits: Vec<u64>, // packed into u64 chunks
    m: usize,       // total bits
    k: usize,       // number of hashes
    n: usize,       // count of inserted items (best-effort, not deduped)
}

impl Bloom {
    /// Create a filter sized to keep ~1% FPR for `expected` items.
    /// Capacity is rounded up to multiples of 64.
    pub fn new(expected: usize) -> Self {
        let target_fpr = 0.01_f64;
        let m = (-(expected as f64) * target_fpr.ln() / (2.0_f64.ln().powi(2)))
            .ceil() as usize;
        let m = ((m + 63) / 64) * 64;
        let k = ((m as f64 / expected.max(1) as f64) * 2.0_f64.ln())
            .round()
            .max(1.0) as usize;
        Self {
            bits: vec![0u64; m / 64],
            m,
            k,
            n: 0,
        }
    }

    pub fn insert(&mut self, key: &str) {
        for h in self.hashes(key) {
            let idx = (h % self.m as u64) as usize;
            self.bits[idx / 64] |= 1u64 << (idx % 64);
        }
        self.n += 1;
    }

    pub fn contains(&self, key: &str) -> bool {
        for h in self.hashes(key) {
            let idx = (h % self.m as u64) as usize;
            if self.bits[idx / 64] & (1u64 << (idx % 64)) == 0 {
                return false;
            }
        }
        true
    }

    pub fn len(&self) -> usize { self.n }
    pub fn bits(&self) -> usize { self.m }
    pub fn is_empty(&self) -> bool { self.n == 0 }

    /// Two seeded hashes + double hashing → k indices.
    fn hashes(&self, key: &str) -> impl Iterator<Item = u64> + '_ {
        let h1 = fnv1a(key.as_bytes(), 0xcbf29ce484222325);
        let h2 = fnv1a(key.as_bytes(), 0x100000001b3);
        (0..self.k).map(move |i| h1.wrapping_add((i as u64).wrapping_mul(h2)))
    }
}

fn fnv1a(bytes: &[u8], seed: u64) -> u64 {
    let mut h = seed;
    for &b in bytes {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}
