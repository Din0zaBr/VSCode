// URSUS Insight — Shared Badges, Tags, and Status Indicators
// Load with <script type="text/babel" src="Badges.jsx"></script>

const SeverityBadge = ({ level }) => {
  const styles = {
    CRITICAL: { bg: 'rgba(255,49,49,0.13)',   color: '#FF3131', border: 'rgba(255,49,49,0.4)' },
    HIGH:     { bg: 'rgba(255,107,0,0.13)',   color: '#FF6B00', border: 'rgba(255,107,0,0.4)' },
    MEDIUM:   { bg: 'rgba(255,215,0,0.13)',   color: '#FFD700', border: 'rgba(255,215,0,0.4)' },
    LOW:      { bg: 'rgba(0,191,255,0.13)',   color: '#00BFFF', border: 'rgba(0,191,255,0.4)' },
    INFO:     { bg: 'rgba(136,136,136,0.13)', color: '#888888', border: 'rgba(136,136,136,0.4)' },
  };
  const s = styles[level] || styles.INFO;
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: '3px',
      fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 'bold',
      letterSpacing: '1px', textTransform: 'uppercase', whiteSpace: 'nowrap',
      background: s.bg, color: s.color, border: `1px solid ${s.border}`
    }}>{level}</span>
  );
};

const StatusBadge = ({ status }) => {
  const styles = {
    OPEN:           { bg: 'rgba(255,49,49,0.13)',   color: '#FF3131', border: 'rgba(255,49,49,0.27)' },
    IN_PROGRESS:    { bg: 'rgba(255,215,0,0.13)',   color: '#FFD700', border: 'rgba(255,215,0,0.27)' },
    RESOLVED:       { bg: 'rgba(57,255,20,0.13)',   color: '#39FF14', border: 'rgba(57,255,20,0.27)' },
    FALSE_POSITIVE: { bg: 'rgba(136,136,136,0.13)', color: '#888',    border: 'rgba(136,136,136,0.27)' },
    ONLINE:         { bg: 'rgba(57,255,20,0.13)',   color: '#39FF14', border: 'rgba(57,255,20,0.27)' },
    OFFLINE:        { bg: 'rgba(255,49,49,0.13)',   color: '#FF3131', border: 'rgba(255,49,49,0.27)' },
    UNKNOWN:        { bg: 'rgba(136,136,136,0.13)', color: '#888',    border: 'rgba(136,136,136,0.27)' },
  };
  const s = styles[status] || styles.UNKNOWN;
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: '3px',
      fontFamily: 'var(--font-mono)', fontSize: '10px',
      letterSpacing: '1px', textTransform: 'uppercase', whiteSpace: 'nowrap',
      background: s.bg, color: s.color, border: `1px solid ${s.border}`
    }}>{status}</span>
  );
};

const IpTag = ({ ip }) => (
  <span style={{
    fontFamily: 'var(--font-mono)', fontSize: '11px', color: '#00BFFF',
    background: 'rgba(0,191,255,0.1)', border: '1px solid rgba(0,191,255,0.3)',
    padding: '1px 6px', borderRadius: '3px', whiteSpace: 'nowrap'
  }}>{ip || '—'}</span>
);

const StatusDot = ({ online }) => (
  <span style={{
    display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%',
    background: online ? '#39FF14' : '#888888',
    boxShadow: online ? '0 0 6px #39FF14' : 'none',
    animation: online ? 'dotPulse 2s ease-in-out infinite' : 'none',
    flexShrink: 0
  }}></span>
);

Object.assign(window, { SeverityBadge, StatusBadge, IpTag, StatusDot });
