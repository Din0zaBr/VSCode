// URSUS Insight — Login Screen
// Load with <script type="text/babel" src="LoginScreen.jsx"></script>

const LoginScreen = ({ onLogin }) => {
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setTimeout(() => {
      if (username === 'admin' && password === 'admin') {
        onLogin();
      } else {
        setError('Неверный логин или пароль');
        setLoading(false);
      }
    }, 600);
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: '#1a2e2e', position: 'relative', overflow: 'hidden'
    }}>
      {/* Cyber grid */}
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none',
        backgroundImage: 'linear-gradient(rgba(106,13,173,.08) 1px, transparent 1px), linear-gradient(90deg, rgba(106,13,173,.08) 1px, transparent 1px)',
        backgroundSize: '40px 40px'
      }}></div>
      {/* Scanlines */}
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none',
        background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,.12) 2px, rgba(0,0,0,.12) 4px)'
      }}></div>

      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: '420px', padding: '20px' }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '36px' }}>
          <span style={{
            display: 'block', fontSize: '56px', marginBottom: '10px', lineHeight: 1,
            filter: 'drop-shadow(0 0 20px #BF40BF)',
            animation: 'bearGlow2 3s ease-in-out infinite'
          }}>🐻</span>
          <span style={{
            display: 'block', fontFamily: 'var(--font-title)', fontSize: '28px',
            fontWeight: 900, color: '#BF40BF', letterSpacing: '6px',
            textShadow: '0 0 20px rgba(191,64,191,0.5)'
          }}>URSUS INSIGHT</span>
          <span style={{
            display: 'block', fontFamily: 'var(--font-mono)', fontSize: '11px',
            color: '#7fa8a8', letterSpacing: '4px', marginTop: '4px'
          }}>SECURITY INFORMATION &amp; EVENT MANAGEMENT</span>
        </div>

        {/* Panel */}
        <div style={{
          background: '#223333', border: '1px solid #3d6060',
          borderRadius: '4px',
          boxShadow: '0 0 40px rgba(106,13,173,.2), inset 0 0 0 1px rgba(255,255,255,.03)'
        }}>
          <div style={{
            padding: '14px 20px', borderBottom: '1px solid #3d6060',
            fontFamily: 'var(--font-mono)', fontSize: '11px', color: '#7fa8a8',
            letterSpacing: '2px', display: 'flex', alignItems: 'center', gap: '8px'
          }}>
            <span style={{ width: '6px', height: '6px', background: '#BF40BF', borderRadius: '50%', boxShadow: '0 0 6px #BF40BF', display: 'inline-block' }}></span>
            АУТЕНТИФИКАЦИЯ
          </div>
          <form onSubmit={handleSubmit} style={{ padding: '28px 24px' }}>
            {error && (
              <div style={{
                background: 'rgba(255,49,49,.1)', border: '1px solid #FF3131',
                borderRadius: '3px', color: '#FF3131',
                fontFamily: 'var(--font-mono)', fontSize: '12px',
                padding: '10px 14px', marginBottom: '18px',
                display: 'flex', alignItems: 'center', gap: '8px'
              }}>⚠ {error}</div>
            )}
            <div style={{ marginBottom: '20px' }}>
              <label style={{
                display: 'block', fontFamily: 'var(--font-mono)', fontSize: '10px',
                letterSpacing: '2px', color: '#7fa8a8', marginBottom: '8px'
              }}>ПОЛЬЗОВАТЕЛЬ</label>
              <input value={username} onChange={e => setUsername(e.target.value)}
                placeholder="admin" autoFocus
                style={{
                  width: '100%', background: '#1a2e2e', border: '1px solid #3d6060',
                  borderRadius: '3px', color: '#e0f0f0', fontFamily: 'var(--font-mono)',
                  fontSize: '14px', padding: '10px 14px', outline: 'none'
                }}
                onFocus={e => e.target.style.borderColor = '#6A0DAD'}
                onBlur={e => e.target.style.borderColor = '#3d6060'}
              />
            </div>
            <div style={{ marginBottom: '24px' }}>
              <label style={{
                display: 'block', fontFamily: 'var(--font-mono)', fontSize: '10px',
                letterSpacing: '2px', color: '#7fa8a8', marginBottom: '8px'
              }}>ПАРОЛЬ</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                style={{
                  width: '100%', background: '#1a2e2e', border: '1px solid #3d6060',
                  borderRadius: '3px', color: '#e0f0f0', fontFamily: 'var(--font-mono)',
                  fontSize: '14px', padding: '10px 14px', outline: 'none'
                }}
                onFocus={e => e.target.style.borderColor = '#6A0DAD'}
                onBlur={e => e.target.style.borderColor = '#3d6060'}
              />
            </div>
            <button type="submit" disabled={loading}
              style={{
                width: '100%', padding: '12px',
                background: 'linear-gradient(135deg, #6A0DAD, #BF40BF)',
                border: 'none', borderRadius: '3px', color: '#fff',
                fontFamily: 'var(--font-title)', fontSize: '13px',
                letterSpacing: '3px', cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.7 : 1,
                boxShadow: '0 0 20px rgba(191,64,191,.3)',
                transition: 'opacity 0.2s'
              }}>
              {loading ? '...' : 'ВОЙТИ'}
            </button>
          </form>
        </div>
        <div style={{
          textAlign: 'center', marginTop: '18px',
          fontFamily: 'var(--font-mono)', fontSize: '10px',
          color: '#7fa8a8', letterSpacing: '1px'
        }}>CYBER FOREST // v1.0.0 // PROTOTYPE</div>
      </div>
    </div>
  );
};

Object.assign(window, { LoginScreen });
