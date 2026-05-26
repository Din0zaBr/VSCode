#[cfg(test)]
mod tests {
    use super::super::Bloom;

    #[test]
    fn inserted_keys_are_found() {
        let mut b = Bloom::new(1000);
        for k in ["1.2.3.4", "evil.example.com", "deadbeef"] {
            b.insert(k);
        }
        assert!(b.contains("1.2.3.4"));
        assert!(b.contains("evil.example.com"));
        assert!(b.contains("deadbeef"));
    }

    #[test]
    fn absent_key_usually_not_found() {
        let mut b = Bloom::new(1000);
        for i in 0..500 {
            b.insert(&format!("ip-{}", i));
        }
        // Probabilistic — 1% FPR at this capacity, so 100 negatives should
        // produce <5 false positives on average. Loose bound to keep CI happy.
        let mut fp = 0;
        for i in 1000..1100 {
            if b.contains(&format!("missing-{}", i)) {
                fp += 1;
            }
        }
        assert!(fp < 10, "too many false positives: {}", fp);
    }

    #[test]
    fn bits_rounded_to_u64() {
        let b = Bloom::new(100);
        assert_eq!(b.bits() % 64, 0);
    }
}
