// URSUS Insight — Dashboard Screen
// Load with <script type="text/babel" src="Dashboard.jsx"></script>

const DEMO_EVENTS = [
  { id: 1247, timestamp: Date.now()/1000 - 90,   severity: 'CRITICAL', category: 'Authentication', source_ip: '10.0.0.42',    source_host: 'srv-web01', raw_message: 'Failed password for root from 10.0.0.42 port 22 ssh2' },
  { id: 1246, timestamp: Date.now()/1000 - 240,  severity: 'HIGH',     category: 'Network',        source_ip: '192.168.1.7',  source_host: 'fw-01',     raw_message: 'Port scan detected: 192.168.1.7 → 10.0.0.0/24 (45 ports)' },
  { id: 1245, timestamp: Date.now()/1000 - 610,  severity: 'MEDIUM',   category: 'Privilege',      source_ip: '10.0.0.15',    source_host: 'db-01',     raw_message: 'sudo: user apache ran COMMAND=/bin/bash as root' },
  { id: 1244, timestamp: Date.now()/1000 - 900,  severity: 'HIGH',     category: 'Malware',        source_ip: '172.16.0.5',   source_host: 'ws-034',    raw_message: 'Malware signature match: Trojan.Agent detected in /tmp/.x11' },
  { id: 1243, timestamp: Date.now()/1000 - 1300, severity: 'LOW',      category: 'System',         source_ip: '10.0.0.100',   source_host: 'mon-01',    raw_message: 'Service nginx stopped unexpectedly, exit code 1' },
  { id: 1242, timestamp: Date.now()/1000 - 1600, severity: 'INFO',     category: 'Authentication', source_ip: '10.0.0.1',     source_host: 'dc-01',     raw_message: 'Successful login: user svcadmin from 10.0.0.1' },
  { id: 1241, timestamp: Date.now()/1000 - 2100, severity: 'CRITICAL', category: 'Intrusion',      source_ip: '185.220.101.3',source_host: '—',          raw_message: 'IDS: SQL injection attempt detected in HTTP request from 185.220.101.3' },
  { id: 1240, timestamp: Date.now()/1000 - 2800, severity: 'MEDIUM',   category: 'Policy',         source_ip: '10.0.0.22',    source_host: 'admin-ws',  raw_message: 'USB device connected on admin-ws, device ID: USB\\VID_0951' },
];

const DEMO_ALERTS = [
  { id: 12, created_at: Date.now()/1000 - 1800, severity: 'CRITICAL', rule_name: 'SSH Brute Force',     source_ip: '10.0.0.42',     status: 'OPEN' },
  { id: 11, created_at: Date.now()/1000 - 3600, severity: 'HIGH',     rule_name: 'Port Scan Detected',  source_ip: '192.168.1.7',   status: 'IN_PROGRESS' },
  { id: 10, created_at: Date.now()/1000 - 7200, severity: 'HIGH',     rule_name: 'Malware Signature',   source_ip: '172.16.0.5',    status: 'OPEN' },
  { id: 9,  created_at: Date.now()/1000 - 9000, severity: 'CRITICAL', rule_name: 'SQL Injection Attempt',source_ip: '185.220.101.3', status: 'OPEN' },
];

const ts2str = ts => {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString('ru-RU', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
};

const Panel = ({ title, action, children }) => (
  <div style={{
    background: 'var(--bg2)', border: '1px solid var(--border)',
    borderRadius: '6px', overflow: 'hidden',
    transition: 'border-color 0.2s'
  }}
  onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(106,13,173,0.27)'}
  onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
  >
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '10px 14px', borderBottom: '1px solid var(--border)', background: 'var(--bg3)'
    }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', letterSpacing: '2px', color: '#BF40BF', textTransform: 'uppercase' }}>{title}</span>
      {action}
    </div>
    {children}
  </div>
);

const BtnSm = ({ children, onClick }) => (
  <button onClick={onClick} style={{
    display: 'inline-flex', alignItems: 'center', gap: '4px',
    padding: '3px 10px', borderRadius: '6px', border: '1px solid var(--border)',
    background: 'var(--bg3)', color: 'var(--text)', fontFamily: 'var(--font-mono)',
    fontSize: '10px', cursor: 'pointer', letterSpacing: '0.5px',
    transition: 'all 0.2s'
  }}
  onMouseEnter={e => { e.currentTarget.style.borderColor = '#6A0DAD'; e.currentTarget.style.color = '#BF40BF'; }}
  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text)'; }}
  >{children}</button>
);

const Dashboard = ({ onNavigate }) => (
  <div style={{ padding: '20px 24px' }}>
    {/* Stat grid */}
    <div style={{ display: 'flex', gap: '14px', marginBottom: '20px', flexWrap: 'wrap' }}>
      <StatCard label="ВСЕГО СОБЫТИЙ"       value="48,291" sub="за всё время"       color="primary" />
      <StatCard label="СОБЫТИЯ / 24Ч"       value="1,247"  sub="последние 24 часа"  color="high" />
      <StatCard label="ОТКРЫТЫЕ ИНЦИДЕНТЫ"  value="7"      sub="требуют внимания"   color="critical" />
      <StatCard label="КРИТИЧЕСКИЕ / 24Ч"   value="3"      sub="критической важности" color="critical" />
      <StatCard label="АГЕНТЫ ONLINE"        value="12"     sub="активных агентов"   color="success" />
    </div>

    {/* Tables row */}
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
      {/* Recent alerts */}
      <Panel title="⚡ ПОСЛЕДНИЕ ИНЦИДЕНТЫ" action={<BtnSm onClick={() => onNavigate('alerts')}>Все →</BtnSm>}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
          <thead>
            <tr>{['Severity','Правило','Источник','Время','Статус'].map(h =>
              <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-dim)', letterSpacing: '1.5px', textTransform: 'uppercase', borderBottom: '1px solid var(--border)', background: 'var(--bg3)', whiteSpace: 'nowrap' }}>{h}</th>
            )}</tr>
          </thead>
          <tbody>
            {DEMO_ALERTS.map((a, i) => (
              <tr key={a.id} style={{ borderBottom: i < DEMO_ALERTS.length-1 ? '1px solid var(--border)' : 'none' }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(106,13,173,0.08)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <td style={{ padding: '8px 12px', verticalAlign: 'middle' }}><SeverityBadge level={a.severity} /></td>
                <td style={{ padding: '8px 12px', color: 'var(--text)', fontWeight: 600, fontFamily: 'var(--font-ui)', fontSize: '12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '120px' }}>{a.rule_name}</td>
                <td style={{ padding: '8px 12px' }}><IpTag ip={a.source_ip} /></td>
                <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>{ts2str(a.created_at)}</td>
                <td style={{ padding: '8px 12px' }}><StatusBadge status={a.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {/* Recent events */}
      <Panel title="◈ ПОСЛЕДНИЕ СОБЫТИЯ" action={<BtnSm onClick={() => onNavigate('events')}>Все →</BtnSm>}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
          <thead>
            <tr>{['Severity','Кат.','Источник','Сообщение','Время'].map(h =>
              <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-dim)', letterSpacing: '1.5px', textTransform: 'uppercase', borderBottom: '1px solid var(--border)', background: 'var(--bg3)', whiteSpace: 'nowrap' }}>{h}</th>
            )}</tr>
          </thead>
          <tbody>
            {DEMO_EVENTS.slice(0,6).map((ev, i) => (
              <tr key={ev.id} style={{ borderBottom: i < 5 ? '1px solid var(--border)' : 'none' }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(106,13,173,0.08)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <td style={{ padding: '8px 12px', verticalAlign: 'middle' }}><SeverityBadge level={ev.severity} /></td>
                <td style={{ padding: '8px 12px', fontFamily: 'var(--font-ui)', fontSize: '12px', color: 'var(--text)', whiteSpace: 'nowrap' }}>{ev.category}</td>
                <td style={{ padding: '8px 12px' }}><IpTag ip={ev.source_ip} /></td>
                <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '130px' }} title={ev.raw_message}>{ev.raw_message.slice(0,40)}…</td>
                <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>{ts2str(ev.timestamp)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  </div>
);

window.DEMO_EVENTS = DEMO_EVENTS;
window.DEMO_ALERTS = DEMO_ALERTS;
window.ts2str = ts2str;
window.Panel = Panel;
window.BtnSm = BtnSm;
Object.assign(window, { Dashboard });
