// URSUS Insight — Sidebar Navigation
// Load with <script type="text/babel" src="Sidebar.jsx"></script>

const Sidebar = ({ activePage, onNavigate, alertCount = 0 }) => {
  const navItems = [
    { id: 'dashboard', icon: '⬡', label: 'Dashboard' },
    { id: 'events',    icon: '◈', label: 'События' },
    { id: 'alerts',    icon: '⚡', label: 'Инциденты', badge: alertCount },
    { id: 'rules',     icon: '⟁', label: 'Правила' },
    { id: 'agents',    icon: '◉', label: 'Агенты' },
  ];

  return (
    <nav style={{
      position: 'fixed', top: 0, left: 0, width: '220px', height: '100vh',
      background: 'var(--bg2)', borderRight: '1px solid var(--border2)',
      display: 'flex', flexDirection: 'column', zIndex: 100,
      boxShadow: '4px 0 24px rgba(106,13,173,0.15)'
    }}>
      {/* Top accent bar */}
      <div style={{ height: '2px', background: 'linear-gradient(90deg, #6A0DAD, #BF40BF)', flexShrink: 0 }}></div>

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '12px',
        padding: '18px 16px 14px', borderBottom: '1px solid var(--border)'
      }}>
        <span style={{
          fontSize: '28px', lineHeight: 1,
          animation: 'bearGlow 3s ease-in-out infinite alternate',
          filter: 'drop-shadow(0 0 8px #BF40BF)'
        }}>🐻</span>
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
          <span style={{
            fontFamily: 'var(--font-title)', fontSize: '18px', fontWeight: 900,
            color: '#BF40BF', letterSpacing: '3px',
            textShadow: '0 0 10px rgba(191,64,191,0.6)'
          }}>URSUS</span>
          <span style={{
            fontFamily: 'var(--font-title)', fontSize: '9px', fontWeight: 400,
            color: 'var(--text-dim)', letterSpacing: '5px'
          }}>INSIGHT</span>
        </div>
      </div>

      {/* Version */}
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)',
        textAlign: 'center', padding: '5px', margin: '6px 12px 4px',
        border: '1px solid var(--border)', borderRadius: '6px', background: 'var(--bg3)'
      }}>v1.0.0 // PROTOTYPE</div>

      {/* Nav links */}
      <ul style={{ listStyle: 'none', flex: 1, padding: '6px 0', overflowY: 'auto' }}>
        {navItems.map(item => {
          const isActive = activePage === item.id;
          return (
            <li key={item.id}>
              <a onClick={() => onNavigate(item.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '11px 18px', textDecoration: 'none', cursor: 'pointer',
                  fontFamily: 'var(--font-ui)', fontSize: '13px', fontWeight: 600,
                  letterSpacing: '0.5px',
                  color: isActive ? '#BF40BF' : 'var(--text-dim)',
                  background: isActive ? 'linear-gradient(90deg, rgba(106,13,173,0.25), transparent)' : 'transparent',
                  borderLeft: isActive ? '3px solid #BF40BF' : '3px solid transparent',
                  transition: 'all 0.2s ease'
                }}>
                <span style={{
                  fontSize: '16px', width: '20px', textAlign: 'center',
                  color: isActive ? '#BF40BF' : '#6A0DAD'
                }}>{item.icon}</span>
                {item.label}
                {item.badge > 0 && (
                  <span style={{
                    marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: '10px',
                    padding: '1px 6px', borderRadius: '10px',
                    background: '#FF3131', color: '#fff',
                    animation: 'pulseBadge 1.5s ease-in-out infinite',
                    boxShadow: '0 0 6px #FF3131'
                  }}>{item.badge}</span>
                )}
              </a>
            </li>
          );
        })}
      </ul>

      {/* Footer */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '12px 18px', borderTop: '1px solid var(--border)',
        fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-dim)'
      }}>
        <StatusDot online={true} />
        <span>Система активна</span>
        <span style={{ marginLeft: 'auto', fontSize: '16px', opacity: 0.5, cursor: 'pointer' }}>⏻</span>
      </div>
    </nav>
  );
};

Object.assign(window, { Sidebar });
