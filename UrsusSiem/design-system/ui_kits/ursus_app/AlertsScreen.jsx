// URSUS Insight — Alerts/Incidents Screen
// Load with <script type="text/babel" src="AlertsScreen.jsx"></script>

const FULL_ALERTS = [
  { id: 12, created_at: Date.now()/1000 - 1800,  severity: 'CRITICAL', rule_name: 'SSH Brute Force',       source_ip: '10.0.0.42',      status: 'OPEN',           description: 'Multiple failed SSH login attempts from 10.0.0.42 — 23 failures in 60s' },
  { id: 11, created_at: Date.now()/1000 - 3600,  severity: 'HIGH',     rule_name: 'Port Scan Detected',    source_ip: '192.168.1.7',    status: 'IN_PROGRESS',    description: 'Horizontal port scan: 45 unique ports probed within 30s' },
  { id: 10, created_at: Date.now()/1000 - 7200,  severity: 'HIGH',     rule_name: 'Malware Signature',     source_ip: '172.16.0.5',     status: 'OPEN',           description: 'ClamAV signature match: Trojan.Agent in /tmp/.x11-unix/.hidden' },
  { id: 9,  created_at: Date.now()/1000 - 9000,  severity: 'CRITICAL', rule_name: 'SQL Injection Attempt', source_ip: '185.220.101.3',  status: 'OPEN',           description: 'WAF blocked SQL injection in GET /api/users?id=1 OR 1=1' },
  { id: 8,  created_at: Date.now()/1000 - 14400, severity: 'MEDIUM',   rule_name: 'Privilege Escalation',  source_ip: '10.0.0.22',      status: 'RESOLVED',       description: 'sudo to root from non-admin user apache on db-01' },
  { id: 7,  created_at: Date.now()/1000 - 18000, severity: 'LOW',      rule_name: 'USB Device Connected',  source_ip: '10.0.0.55',      status: 'FALSE_POSITIVE', description: 'USB storage device connected on admin-ws (approved device)' },
];

const AlertsScreen = () => {
  const [alerts, setAlerts] = React.useState(FULL_ALERTS);
  const [statusFilter, setStatusFilter] = React.useState('OPEN');
  const [sevFilter, setSevFilter] = React.useState('');
  const [selectedAlert, setSelectedAlert] = React.useState(null);
  const [notes, setNotes] = React.useState('');

  const filtered = alerts.filter(a => {
    if (statusFilter && a.status !== statusFilter) return false;
    if (sevFilter && a.severity !== sevFilter) return false;
    return true;
  });

  const updateStatus = (id, status) => {
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, status } : a));
    if (selectedAlert && selectedAlert.id === id) setSelectedAlert(prev => ({ ...prev, status }));
  };

  const inputStyle = {
    background: 'var(--bg3)', border: '1px solid var(--border)',
    borderRadius: '6px', color: 'var(--text)', fontFamily: 'var(--font-mono)',
    fontSize: '11px', padding: '5px 10px', outline: 'none', height: '30px'
  };

  const BtnAction = ({ children, onClick, variant }) => {
    const colors = { primary: { border: '#6A0DAD', color: '#BF40BF', bg: 'rgba(106,13,173,0.2)' }, success: { border: '#39FF14', color: '#39FF14', bg: 'transparent' }, default: { border: 'var(--border)', color: 'var(--text)', bg: 'var(--bg3)' } };
    const c = colors[variant] || colors.default;
    return (
      <button onClick={onClick} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '3px 9px', borderRadius: '6px', border: `1px solid ${c.border}`, background: c.bg, color: c.color, fontFamily: 'var(--font-mono)', fontSize: '10px', cursor: 'pointer', whiteSpace: 'nowrap' }}>{children}</button>
    );
  };

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '6px', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid var(--border)', background: 'var(--bg3)', gap: '10px', flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: '#BF40BF', letterSpacing: '2px', textTransform: 'uppercase' }}>⚡ ИНЦИДЕНТЫ</span>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <select style={inputStyle} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="">Все статусы</option>
              {['OPEN','IN_PROGRESS','RESOLVED','FALSE_POSITIVE'].map(s => <option key={s}>{s}</option>)}
            </select>
            <select style={inputStyle} value={sevFilter} onChange={e => setSevFilter(e.target.value)}>
              <option value="">Все severity</option>
              {['CRITICAL','HIGH','MEDIUM','LOW'].map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
        </div>

        {/* Table */}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
          <thead>
            <tr>{['#','Время','Severity','Правило','Источник','Описание','Статус','Действия'].map((h,i) =>
              <th key={i} style={{ padding: '8px 12px', textAlign: 'left', fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-dim)', letterSpacing: '1.5px', textTransform: 'uppercase', borderBottom: '1px solid var(--border)', background: 'var(--bg3)', whiteSpace: 'nowrap' }}>{h}</th>
            )}</tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan="8" style={{ padding: '30px', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-dim)' }}>Нет инцидентов</td></tr>
            )}
            {filtered.map((a, i) => (
              <tr key={a.id} style={{ borderBottom: i < filtered.length-1 ? '1px solid var(--border)' : 'none' }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(106,13,173,0.08)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)' }}>{a.id}</td>
                <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>{ts2str(a.created_at)}</td>
                <td style={{ padding: '8px 12px' }}><SeverityBadge level={a.severity} /></td>
                <td style={{ padding: '8px 12px', fontFamily: 'var(--font-ui)', fontSize: '13px', color: 'var(--text)', fontWeight: 600, whiteSpace: 'nowrap' }}>{a.rule_name}</td>
                <td style={{ padding: '8px 12px' }}><IpTag ip={a.source_ip} /></td>
                <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '180px' }} title={a.description}>{(a.description || '—').slice(0,50)}…</td>
                <td style={{ padding: '8px 12px' }}><StatusBadge status={a.status} /></td>
                <td style={{ padding: '8px 12px' }}>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <BtnAction onClick={() => { setSelectedAlert(a); setNotes(''); }}>⊕</BtnAction>
                    {a.status === 'OPEN' && <>
                      <BtnAction variant="primary" onClick={() => updateStatus(a.id, 'IN_PROGRESS')}>▶</BtnAction>
                      <BtnAction variant="success" onClick={() => updateStatus(a.id, 'RESOLVED')}>✓</BtnAction>
                      <BtnAction onClick={() => updateStatus(a.id, 'FALSE_POSITIVE')}>✗</BtnAction>
                    </>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Pagination */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', padding: '10px 14px', borderTop: '1px solid var(--border)', background: 'var(--bg3)', fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-dim)' }}>
          <span>{filtered.length} инцидентов</span>
        </div>
      </div>

      {/* Alert detail modal */}
      <Modal open={!!selectedAlert} onClose={() => setSelectedAlert(null)} title="⚡ ДЕТАЛИ ИНЦИДЕНТА">
        {selectedAlert && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
              <FormGroup label="Severity"><SeverityBadge level={selectedAlert.severity} /></FormGroup>
              <FormGroup label="Статус"><StatusBadge status={selectedAlert.status} /></FormGroup>
            </div>
            <FormGroup label="Правило">
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text)' }}>{selectedAlert.rule_name}</span>
            </FormGroup>
            <FormGroup label="Описание">
              <span style={{ fontSize: '13px', color: 'var(--text)', fontFamily: 'var(--font-ui)' }}>{selectedAlert.description}</span>
            </FormGroup>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
              <FormGroup label="Источник"><IpTag ip={selectedAlert.source_ip} /></FormGroup>
              <FormGroup label="Время"><span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text)' }}>{ts2str(selectedAlert.created_at)}</span></FormGroup>
            </div>
            <FormGroup label="Заметки">
              <FormControl value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Добавить заметки..." />
            </FormGroup>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '14px' }}>
              <button onClick={() => setSelectedAlert(null)} style={{ padding: '5px 14px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: '11px', cursor: 'pointer' }}>Отмена</button>
              {selectedAlert.status === 'OPEN' && (
                <button onClick={() => { updateStatus(selectedAlert.id, 'RESOLVED'); setSelectedAlert(null); }}
                  style={{ padding: '5px 14px', borderRadius: '6px', border: '1px solid #39FF14', background: 'rgba(57,255,20,0.1)', color: '#39FF14', fontFamily: 'var(--font-mono)', fontSize: '11px', cursor: 'pointer' }}>✓ Закрыть</button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

Object.assign(window, { AlertsScreen });
