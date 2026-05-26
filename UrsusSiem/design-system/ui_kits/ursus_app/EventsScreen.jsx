// URSUS Insight — Events Screen
// Load with <script type="text/babel" src="EventsScreen.jsx"></script>

const EventsScreen = () => {
  const [search, setSearch] = React.useState('');
  const [sevFilter, setSevFilter] = React.useState('');
  const [catFilter, setCatFilter] = React.useState('');
  const [selectedEvent, setSelectedEvent] = React.useState(null);

  const filtered = DEMO_EVENTS.filter(ev => {
    if (sevFilter && ev.severity !== sevFilter) return false;
    if (catFilter && ev.category !== catFilter) return false;
    if (search && !ev.raw_message.toLowerCase().includes(search.toLowerCase()) &&
        !ev.source_ip.includes(search)) return false;
    return true;
  });

  const inputStyle = {
    background: 'var(--bg3)', border: '1px solid var(--border)',
    borderRadius: '6px', color: 'var(--text)', fontFamily: 'var(--font-mono)',
    fontSize: '11px', padding: '5px 10px', outline: 'none', height: '30px',
    transition: 'border-color 0.2s'
  };

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{
        background: 'var(--bg2)', border: '1px solid var(--border)',
        borderRadius: '6px', overflow: 'hidden'
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px', borderBottom: '1px solid var(--border)',
          background: 'var(--bg3)', gap: '10px', flexWrap: 'wrap'
        }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: '#BF40BF', letterSpacing: '2px', textTransform: 'uppercase' }}>◈ ЖУРНАЛ СОБЫТИЙ</span>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <input style={{ ...inputStyle, width: '180px' }} placeholder="Поиск в логах..."
              value={search} onChange={e => setSearch(e.target.value)}
              onFocus={e => e.target.style.borderColor = '#6A0DAD'}
              onBlur={e => e.target.style.borderColor = 'var(--border)'}
            />
            <select style={inputStyle} value={sevFilter} onChange={e => setSevFilter(e.target.value)}>
              <option value="">Все severity</option>
              {['CRITICAL','HIGH','MEDIUM','LOW','INFO'].map(s => <option key={s}>{s}</option>)}
            </select>
            <select style={inputStyle} value={catFilter} onChange={e => setCatFilter(e.target.value)}>
              <option value="">Все категории</option>
              {['Authentication','Network','Malware','Privilege','System','Application','Intrusion','Policy','Other'].map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>

        {/* Table */}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
          <thead>
            <tr>{['#','Время','Severity','Категория','Тип','Источник','Хост','Сообщение',''].map((h,i) =>
              <th key={i} style={{ padding: '8px 12px', textAlign: 'left', fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-dim)', letterSpacing: '1.5px', textTransform: 'uppercase', borderBottom: '1px solid var(--border)', background: 'var(--bg3)', whiteSpace: 'nowrap' }}>{h}</th>
            )}</tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan="9" style={{ padding: '30px', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-dim)' }}>Нет событий по фильтру</td></tr>
            )}
            {filtered.map((ev, i) => (
              <tr key={ev.id} style={{ borderBottom: i < filtered.length-1 ? '1px solid var(--border)' : 'none', cursor: 'pointer' }}
                onClick={() => setSelectedEvent(ev)}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(106,13,173,0.08)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)' }}>{ev.id}</td>
                <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>{ts2str(ev.timestamp)}</td>
                <td style={{ padding: '8px 12px' }}><SeverityBadge level={ev.severity} /></td>
                <td style={{ padding: '8px 12px', fontFamily: 'var(--font-ui)', fontSize: '13px', color: 'var(--text)' }}>{ev.category}</td>
                <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)' }}>syslog</td>
                <td style={{ padding: '8px 12px' }}><IpTag ip={ev.source_ip} /></td>
                <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)' }}>{ev.source_host}</td>
                <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px' }} title={ev.raw_message}>{ev.raw_message.slice(0,60)}…</td>
                <td style={{ padding: '8px 12px' }}>
                  <button onClick={e => { e.stopPropagation(); setSelectedEvent(ev); }}
                    style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: '10px', padding: '2px 8px', cursor: 'pointer' }}>⊕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Pagination */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
          gap: '8px', padding: '10px 14px', borderTop: '1px solid var(--border)',
          background: 'var(--bg3)', fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-dim)'
        }}>
          <span>{filtered.length.toLocaleString()} событий</span>
          <button style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: '10px', padding: '3px 10px', cursor: 'not-allowed', opacity: 0.4 }}>← Пред</button>
          <span>стр. 1 из 1</span>
          <button style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: '10px', padding: '3px 10px', cursor: 'not-allowed', opacity: 0.4 }}>След →</button>
        </div>
      </div>

      {/* Event detail modal */}
      <Modal open={!!selectedEvent} onClose={() => setSelectedEvent(null)} title="◈ ДЕТАЛИ СОБЫТИЯ">
        {selectedEvent && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
              <FormGroup label="ID / Время">
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text)' }}>#{selectedEvent.id} | {ts2str(selectedEvent.timestamp)}</span>
              </FormGroup>
              <FormGroup label="Severity">
                <SeverityBadge level={selectedEvent.severity} />
              </FormGroup>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
              <FormGroup label="Категория">
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text)' }}>{selectedEvent.category}</span>
              </FormGroup>
              <FormGroup label="Источник IP">
                <IpTag ip={selectedEvent.source_ip} />
              </FormGroup>
            </div>
            <FormGroup label="Хост">
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text)' }}>{selectedEvent.source_host}</span>
            </FormGroup>
            <FormGroup label="RAW LOG">
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text)', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '4px', padding: '10px', wordBreak: 'break-all', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{selectedEvent.raw_message}</div>
            </FormGroup>
          </div>
        )}
      </Modal>
    </div>
  );
};

Object.assign(window, { EventsScreen });
