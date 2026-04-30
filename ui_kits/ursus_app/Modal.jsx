// URSUS Insight — Modal Component
// Load with <script type="text/babel" src="Modal.jsx"></script>

const Modal = ({ open, onClose, title, children, width = 560 }) => {
  React.useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose(); };
    if (open) document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(3px)',
        zIndex: 1000, display: 'flex',
        alignItems: 'center', justifyContent: 'center'
      }}>
      <div style={{
        background: 'var(--bg2)', border: '1px solid #6A0DAD',
        borderRadius: '8px', padding: '24px',
        width: `${width}px`, maxWidth: '95vw',
        maxHeight: '80vh', overflowY: 'auto',
        boxShadow: '0 0 40px rgba(106,13,173,0.3)',
        position: 'relative', animation: 'fadeIn 0.2s ease'
      }}>
        <div style={{
          fontFamily: 'var(--font-title)', fontSize: '14px', color: '#BF40BF',
          letterSpacing: '2px', marginBottom: '16px',
          borderBottom: '1px solid var(--border)', paddingBottom: '10px',
          textTransform: 'uppercase'
        }}>{title}</div>
        <button onClick={onClose} style={{
          position: 'absolute', top: '16px', right: '16px',
          background: 'none', border: 'none', color: 'var(--text-dim)',
          fontSize: '18px', cursor: 'pointer', lineHeight: 1
        }}>✕</button>
        {children}
      </div>
    </div>
  );
};

const FormGroup = ({ label, children }) => (
  <div style={{ marginBottom: '14px' }}>
    <label style={{
      display: 'block', fontFamily: 'var(--font-mono)', fontSize: '10px',
      color: 'var(--text-dim)', letterSpacing: '1px', marginBottom: '5px',
      textTransform: 'uppercase'
    }}>{label}</label>
    {children}
  </div>
);

const FormControl = ({ value, onChange, placeholder, rows, readOnly }) => {
  const shared = {
    width: '100%', background: 'var(--bg3)', border: '1px solid var(--border)',
    borderRadius: '6px', color: 'var(--text)', fontFamily: 'var(--font-mono)',
    fontSize: '12px', padding: '7px 10px', outline: 'none', resize: 'vertical',
    transition: 'border-color 0.2s'
  };
  if (rows) return <textarea value={value} onChange={onChange} placeholder={placeholder}
    readOnly={readOnly} rows={rows} style={shared}
    onFocus={e => e.target.style.borderColor = '#6A0DAD'}
    onBlur={e => e.target.style.borderColor = 'var(--border)'}
  />;
  return <input value={value} onChange={onChange} placeholder={placeholder}
    readOnly={readOnly} style={{ ...shared, height: '32px', resize: 'none' }}
    onFocus={e => e.target.style.borderColor = '#6A0DAD'}
    onBlur={e => e.target.style.borderColor = 'var(--border)'}
  />;
};

Object.assign(window, { Modal, FormGroup, FormControl });
