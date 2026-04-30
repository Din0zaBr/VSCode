// URSUS Insight — Stat Card component
// Load with <script type="text/babel" src="StatCard.jsx"></script>

const ACCENT_BARS = {
  primary:  'linear-gradient(90deg, #6A0DAD, #BF40BF)',
  critical: '#FF3131',
  high:     '#FF6B00',
  medium:   '#FFD700',
  low:      '#00BFFF',
  success:  '#39FF14',
};

const VALUE_COLORS = {
  primary:  '#BF40BF',
  critical: '#FF3131',
  high:     '#FF6B00',
  medium:   '#FFD700',
  low:      '#00BFFF',
  success:  '#39FF14',
  default:  '#EEEEFF',
};

const StatCard = ({ label, value, sub, color = 'default' }) => {
  const barBg = ACCENT_BARS[color] || ACCENT_BARS.primary;
  const valColor = VALUE_COLORS[color] || VALUE_COLORS.default;
  const glowColor = color === 'critical' ? 'rgba(255,49,49,0.2)'
                  : color === 'success'  ? 'rgba(57,255,20,0.15)'
                  : 'none';
  return (
    <div style={{
      background: 'var(--bg2)', border: '1px solid var(--border)',
      borderRadius: '6px', padding: '16px 18px',
      position: 'relative', overflow: 'hidden',
      transition: 'border-color 0.2s, transform 0.2s',
      flex: '1 1 150px', minWidth: '140px'
    }}
    onMouseEnter={e => { e.currentTarget.style.borderColor = '#6A0DAD'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.transform = 'none'; }}>
      {/* Top accent bar */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: barBg }}></div>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)',
        letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '6px'
      }}>{label}</div>
      <div style={{
        fontFamily: 'var(--font-title)', fontSize: '28px', fontWeight: 700,
        color: valColor, lineHeight: 1,
        textShadow: glowColor !== 'none' ? `0 0 8px ${glowColor}` : 'none'
      }}>{value}</div>
      {sub && <div style={{
        fontFamily: 'var(--font-mono)', fontSize: '10px',
        color: 'var(--text-dim)', marginTop: '4px'
      }}>{sub}</div>}
    </div>
  );
};

Object.assign(window, { StatCard });
