// URSUS Insight — Top Bar
// Load with <script type="text/babel" src="TopBar.jsx"></script>

const TopBar = ({ pageTitle, breadcrumb, queueSize = '—' }) => {
  const [time, setTime] = React.useState('');

  React.useEffect(() => {
    const tick = () => {
      setTime(new Date().toLocaleTimeString('ru-RU', { hour12: false }));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <header style={{
      height: '64px', background: 'var(--bg2)',
      borderBottom: '1px solid var(--border)',
      display: 'flex', alignItems: 'center',
      justifyContent: 'space-between', padding: '0 24px',
      flexShrink: 0, position: 'relative'
    }}>
      {/* Gradient underline */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, height: '1px',
        background: 'linear-gradient(90deg, transparent, #6A0DAD, #BF40BF, transparent)',
        opacity: 0.5
      }}></div>

      <div>
        <h1 style={{
          fontFamily: 'var(--font-title)', fontSize: '16px', fontWeight: 700,
          color: 'var(--text-bright)', letterSpacing: '2px', textTransform: 'uppercase'
        }}>{pageTitle}</h1>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-dim)', marginTop: '2px'
        }}>{breadcrumb}</div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-dim)', letterSpacing: '1px' }}>LOCAL TIME</span>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: '16px', color: '#BF40BF',
            fontWeight: 'bold', letterSpacing: '2px',
            textShadow: '0 0 8px rgba(191,64,191,0.5)'
          }}>{time}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-dim)', letterSpacing: '1px' }}>QUEUE</span>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: '16px', color: '#6A0DAD', fontWeight: 'bold'
          }}>{queueSize}</span>
        </div>
      </div>
    </header>
  );
};

Object.assign(window, { TopBar });
