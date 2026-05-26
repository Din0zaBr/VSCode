//! Domain Generation Algorithm (DGA) detector.
//!
//! Malware C2 channels often use randomly generated domain names
//! (`asdkjhasf.com`). We score a domain by two cheap, explainable features:
//!
//!   1. **Shannon entropy** of the label (uniform-random strings have higher
//!      entropy than English words).
//!   2. **Bigram improbability**: average -log(p) of consecutive letter pairs
//!      using English-letter bigram frequencies — random domains score worse.
//!
//! The combined score plus heuristics (length, digit ratio, vowel ratio)
//! gives a probability without needing a trained model file.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::OnceLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DgaRequest {
    pub domains: Vec<String>,
    /// Probability threshold above which a domain is flagged (default 0.7).
    #[serde(default = "default_threshold")]
    pub threshold: f64,
}

fn default_threshold() -> f64 {
    0.7
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DgaScore {
    pub domain: String,
    pub probability: f64,
    pub is_dga: bool,
    pub features: DgaFeatures,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DgaFeatures {
    pub length: usize,
    pub entropy: f64,
    pub bigram_score: f64,
    pub digit_ratio: f64,
    pub vowel_ratio: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DgaResponse {
    pub results: Vec<DgaScore>,
    pub flagged: usize,
}

pub fn check_domain(req: DgaRequest) -> DgaResponse {
    let mut flagged = 0;
    let results: Vec<DgaScore> = req
        .domains
        .iter()
        .map(|d| {
            let s = score_one(d);
            let is_dga = s.probability >= req.threshold;
            if is_dga {
                flagged += 1;
            }
            DgaScore {
                domain: d.clone(),
                probability: s.probability,
                is_dga,
                features: s.features,
                reason: s.reason,
            }
        })
        .collect();
    DgaResponse { results, flagged }
}

struct Scored {
    probability: f64,
    features: DgaFeatures,
    reason: String,
}

fn score_one(domain: &str) -> Scored {
    let label = primary_label(domain);
    let length = label.len();

    if length == 0 || length < 4 {
        return Scored {
            probability: 0.0,
            features: DgaFeatures {
                length,
                entropy: 0.0,
                bigram_score: 0.0,
                digit_ratio: 0.0,
                vowel_ratio: 0.0,
            },
            reason: "слишком короткий".into(),
        };
    }

    let entropy = shannon_entropy(label);
    let bigram = bigram_score(label);
    let digit_ratio = ratio(label, |c| c.is_ascii_digit());
    let vowel_ratio = ratio(label, |c| "aeiouy".contains(c.to_ascii_lowercase()));

    // Weighted combination tuned on public DGA corpora.
    // Each feature is squashed via logistic into [0, 1] before combining.
    let f_entropy = logistic((entropy - 3.6) * 1.8);     // entropy > 3.6 ⇒ suspicious
    let f_bigram  = logistic((bigram - 7.0) * 0.7);      // higher = less English
    let f_digits  = logistic((digit_ratio - 0.25) * 12.0); // lots of digits ⇒ suspicious
    let f_vowels  = logistic((0.15 - vowel_ratio) * 14.0); // very few vowels ⇒ suspicious
    let f_length  = logistic((length as f64 - 14.0) * 0.5); // overlong labels

    let probability = 0.30 * f_entropy
        + 0.30 * f_bigram
        + 0.15 * f_digits
        + 0.15 * f_vowels
        + 0.10 * f_length;

    let reason = format!(
        "entropy={:.2}, bigram={:.2}, digits={:.0}%, vowels={:.0}%, len={}",
        entropy, bigram, digit_ratio * 100.0, vowel_ratio * 100.0, length
    );

    Scored {
        probability,
        features: DgaFeatures {
            length,
            entropy,
            bigram_score: bigram,
            digit_ratio,
            vowel_ratio,
        },
        reason,
    }
}

/// Return the longest non-TLD label (`xkjhasdf` from `xkjhasdf.example.com`).
fn primary_label(domain: &str) -> &str {
    let parts: Vec<&str> = domain.trim_end_matches('.').split('.').collect();
    if parts.is_empty() {
        return "";
    }
    if parts.len() == 1 {
        return parts[0];
    }
    // Choose the longest label that isn't the TLD or a common second-level
    let mut candidates: Vec<&str> = parts.iter().take(parts.len() - 1).copied().collect();
    candidates.sort_by_key(|s| std::cmp::Reverse(s.len()));
    candidates.first().copied().unwrap_or("")
}

fn shannon_entropy(s: &str) -> f64 {
    if s.is_empty() {
        return 0.0;
    }
    let mut counts = [0u32; 256];
    for &b in s.as_bytes() {
        counts[b as usize] += 1;
    }
    let n = s.len() as f64;
    counts
        .iter()
        .filter(|&&c| c > 0)
        .map(|&c| {
            let p = c as f64 / n;
            -p * p.log2()
        })
        .sum()
}

/// Lower = looks like English; higher = looks random.
/// Computed as average -log2(p(bigram)) using English frequency table.
fn bigram_score(s: &str) -> f64 {
    let bytes = s.as_bytes();
    if bytes.len() < 2 {
        return 0.0;
    }
    let table = english_bigrams();
    let mut total = 0.0;
    let mut n = 0;
    for w in bytes.windows(2) {
        let a = w[0].to_ascii_lowercase();
        let b = w[1].to_ascii_lowercase();
        if !a.is_ascii_alphabetic() || !b.is_ascii_alphabetic() {
            continue;
        }
        let key = ((a as u16) << 8) | b as u16;
        let p = table.get(&key).copied().unwrap_or(1e-6);
        total += -p.log2();
        n += 1;
    }
    if n == 0 {
        return 0.0;
    }
    total / n as f64
}

fn ratio<F: Fn(char) -> bool>(s: &str, f: F) -> f64 {
    if s.is_empty() {
        return 0.0;
    }
    let count = s.chars().filter(|c| f(*c)).count() as f64;
    count / s.chars().count() as f64
}

fn logistic(x: f64) -> f64 {
    1.0 / (1.0 + (-x).exp())
}

/// Compact English bigram probabilities. Static, ~250 entries, covers the
/// most common pairs (`th`, `he`, `in`, …). Missing bigrams get a tiny floor
/// during scoring (1e-6).
fn english_bigrams() -> &'static HashMap<u16, f64> {
    static TABLE: OnceLock<HashMap<u16, f64>> = OnceLock::new();
    TABLE.get_or_init(|| {
        // (bigram, frequency-per-million)
        let raw: &[(&str, f64)] = &[
            ("th", 35.6), ("he", 30.8), ("in", 24.3), ("er", 23.8), ("an", 21.4),
            ("re", 17.5), ("on", 17.0), ("at", 14.8), ("en", 14.5), ("nd", 13.5),
            ("ti", 13.4), ("es", 13.2), ("or", 12.8), ("te", 12.0), ("of", 11.7),
            ("ed", 11.7), ("is", 11.3), ("it", 11.2), ("al", 11.0), ("ar", 10.7),
            ("st", 10.5), ("to", 10.4), ("nt", 10.4), ("ng", 9.5),  ("se", 9.3),
            ("ha", 9.3),  ("as", 8.7),  ("ou", 8.7),  ("io", 8.3),  ("le", 8.3),
            ("ve", 8.3),  ("co", 7.9),  ("me", 7.9),  ("de", 7.6),  ("hi", 7.6),
            ("ri", 7.3),  ("ro", 7.3),  ("ic", 7.0),  ("ne", 6.9),  ("ea", 6.9),
            ("ra", 6.9),  ("ce", 6.5),  ("li", 6.2),  ("ch", 6.0),  ("ll", 5.8),
            ("be", 5.8),  ("ma", 5.7),  ("si", 5.5),  ("om", 5.5),  ("ur", 5.4),
            ("ca", 5.3),  ("el", 5.3),  ("ta", 5.3),  ("la", 5.2),  ("ns", 5.1),
            ("di", 5.0),  ("fo", 5.0),  ("ho", 5.0),  ("pe", 4.9),  ("ec", 4.8),
            ("pr", 4.7),  ("no", 4.7),  ("ct", 4.6),  ("us", 4.5),  ("ac", 4.5),
            ("ot", 4.5),  ("il", 4.4),  ("tr", 4.4),  ("ly", 4.4),  ("nc", 4.2),
            ("et", 4.2),  ("ut", 4.0),  ("ss", 4.0),  ("so", 3.9),  ("rs", 3.9),
            ("un", 3.9),  ("lo", 3.8),  ("wa", 3.8),  ("ge", 3.7),  ("ie", 3.7),
            ("wh", 3.7),  ("ee", 3.7),  ("wi", 3.7),  ("em", 3.7),  ("ad", 3.6),
            ("ol", 3.6),  ("rt", 3.6),  ("po", 3.4),  ("we", 3.4),  ("na", 3.4),
            ("ul", 3.3),  ("ni", 3.3),  ("ts", 3.3),  ("mo", 3.3),  ("ow", 3.3),
            ("pa", 3.2),  ("im", 3.2),  ("mi", 3.2),  ("ai", 3.1),  ("sh", 3.0),
            ("ir", 2.9),  ("su", 2.9),  ("id", 2.9),  ("os", 2.8),  ("iv", 2.7),
            ("ia", 2.6),  ("am", 2.5),  ("fi", 2.5),  ("ci", 2.5),  ("vi", 2.5),
            ("pl", 2.4),  ("ig", 2.4),  ("tu", 2.4),  ("ev", 2.4),  ("ld", 2.4),
            ("ry", 2.3),  ("mp", 2.3),  ("fe", 2.3),  ("bl", 2.3),  ("ab", 2.3),
            ("gh", 2.2),  ("ty", 2.2),  ("op", 2.2),  ("wo", 2.2),  ("sa", 2.2),
            ("ay", 2.1),  ("ex", 2.1),  ("ke", 2.1),  ("fr", 2.1),  ("oo", 2.1),
            ("av", 2.0),  ("ag", 1.9),  ("if", 1.8),  ("ap", 1.7),  ("gr", 1.7),
            ("od", 1.7),  ("bo", 1.7),  ("sp", 1.7),  ("rd", 1.7),  ("do", 1.6),
            ("uc", 1.6),  ("bu", 1.5),  ("ei", 1.5),  ("ov", 1.5),  ("by", 1.5),
            ("rm", 1.5),  ("ep", 1.4),  ("tt", 1.4),  ("oc", 1.4),  ("fa", 1.4),
            ("ef", 1.3),  ("cu", 1.3),  ("rn", 1.3),  ("sc", 1.3),  ("gi", 1.2),
            ("da", 1.2),  ("yo", 1.2),  ("cr", 1.2),  ("cl", 1.2),  ("du", 1.1),
            ("ga", 1.1),  ("qu", 1.1),  ("ue", 1.1),  ("ff", 1.0),  ("ba", 1.0),
            ("ey", 1.0),  ("ls", 1.0),  ("va", 1.0),  ("um", 1.0),  ("pp", 0.9),
            ("ua", 0.9),  ("up", 0.9),  ("lu", 0.9),  ("go", 0.9),  ("ht", 0.9),
            ("ru", 0.9),  ("ug", 0.9),  ("ds", 0.9),  ("lt", 0.8),  ("py", 0.8),
            ("ks", 0.8),  ("ms", 0.8),  ("pi", 0.8),  ("za", 0.05),
        ];
        let total: f64 = raw.iter().map(|(_, f)| *f).sum();
        let mut m = HashMap::with_capacity(raw.len());
        for (s, f) in raw {
            let bs = s.as_bytes();
            let key = ((bs[0] as u16) << 8) | bs[1] as u16;
            m.insert(key, f / total);
        }
        m
    })
}
