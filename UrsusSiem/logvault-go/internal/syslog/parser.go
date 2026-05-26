// Package syslog implements minimal RFC 5424 (modern) and RFC 3164 (legacy
// BSD) parsers and a UDP/TCP listener that feeds the URSUS ingest pipeline.
//
// The parsers are deliberately permissive: real-world network gear emits
// log lines that don't strictly match either RFC. When a field is missing
// or malformed we fall back to sensible defaults and stash the original
// text in `message`, so nothing is lost.
package syslog

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/ursus-siem/logvault-go/internal/storage"
)

// Severity / facility mapping per RFC 5424 §6.2.1.
//
// Priority value = facility * 8 + severity
//
// severity 0 (emerg) → "emergency", 7 (debug) → "debug"
var severityName = [...]string{
	"emergency", "alert", "critical", "error",
	"warning", "notice", "info", "debug",
}

func severityFromPri(pri int) string {
	sev := pri & 0x07
	if sev >= 0 && sev < len(severityName) {
		return severityName[sev]
	}
	return "info"
}

func facilityFromPri(pri int) int { return pri >> 3 }

// Parse takes a single syslog line (without trailing newline) and a hint
// about the wire it came from. It tries RFC 5424 first, falls back to
// RFC 3164. Returns a LogEvent ready for storage.BulkIndex.
func Parse(raw, sourceTag string) storage.LogEvent {
	raw = strings.TrimRight(raw, "\r\n\x00")
	if raw == "" {
		return makeUnstructured("", sourceTag)
	}

	if ev, ok := tryRFC5424(raw, sourceTag); ok {
		return ev
	}
	if ev, ok := tryRFC3164(raw, sourceTag); ok {
		return ev
	}
	// Unparseable — keep the whole thing as a message
	return makeUnstructured(raw, sourceTag)
}

// ─── RFC 5424 ────────────────────────────────────────────────────────────────
// <PRI>VERSION TIMESTAMP HOSTNAME APP-NAME PROCID MSGID STRUCTURED-DATA MSG
//
// Example:
//   <34>1 2026-05-24T22:14:15.003Z mymachine.example.com su - ID47 - 'su root' failed for lonvick on /dev/pts/8

func tryRFC5424(raw, sourceTag string) (storage.LogEvent, bool) {
	if len(raw) < 5 || raw[0] != '<' {
		return storage.LogEvent{}, false
	}
	end := strings.IndexByte(raw, '>')
	if end <= 1 || end > 5 {
		return storage.LogEvent{}, false
	}
	pri, err := strconv.Atoi(raw[1:end])
	if err != nil || pri < 0 || pri > 191 {
		return storage.LogEvent{}, false
	}
	rest := raw[end+1:]

	// VERSION must be "1" and followed by space.
	if !strings.HasPrefix(rest, "1 ") {
		return storage.LogEvent{}, false
	}
	parts := strings.SplitN(rest[2:], " ", 6)
	if len(parts) < 5 {
		return storage.LogEvent{}, false
	}
	timestamp := parts[0]
	hostname := parts[1]
	appName := parts[2]
	procID := parts[3]
	msgID := parts[4]

	// parts[5] = STRUCTURED-DATA MSG ; STRUCTURED-DATA may be "-" or "[...]"
	var sdAndMsg string
	if len(parts) == 6 {
		sdAndMsg = parts[5]
	}
	sd, msg := splitStructuredData(sdAndMsg)

	ts := parseRFC5424Time(timestamp)
	ev := storage.LogEvent{
		EventID:   uuid.NewString(),
		Timestamp: ts,
		Host:      cleanNil(hostname),
		AgentID:   "syslog:" + sourceTag,
		Source:    "syslog",
		Level:     severityFromPri(pri),
		Message:   msg,
		Service:   cleanNil(appName),
		Meta: map[string]any{
			"syslog.facility": facilityFromPri(pri),
			"syslog.priority": pri,
			"syslog.version":  "5424",
			"proc_id":         cleanNil(procID),
			"msg_id":          cleanNil(msgID),
		},
	}
	for k, v := range sd {
		ev.Meta["sd."+k] = v
	}
	return ev, true
}

// splitStructuredData handles either:
//   "- this is the message"            → (nil, "this is the message")
//   "[origin ip=...] message text"     → (parsed, "message text")
//   "[a b=c][d e=f] msg"               → both parsed, msg returned
func splitStructuredData(s string) (map[string]string, string) {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil, ""
	}
	if strings.HasPrefix(s, "- ") || s == "-" {
		rest := strings.TrimPrefix(s, "-")
		return nil, strings.TrimSpace(rest)
	}
	if s[0] != '[' {
		return nil, s
	}
	sd := map[string]string{}
	for len(s) > 0 && s[0] == '[' {
		end := strings.IndexByte(s, ']')
		if end == -1 {
			break
		}
		blk := s[1:end]
		// Take SD-ID (first token), then k=v pairs
		toks := strings.SplitN(blk, " ", 2)
		sdID := toks[0]
		if len(toks) == 2 {
			for _, kv := range splitQuoted(toks[1]) {
				eq := strings.IndexByte(kv, '=')
				if eq > 0 {
					k := strings.TrimSpace(kv[:eq])
					v := strings.Trim(strings.TrimSpace(kv[eq+1:]), `"`)
					sd[sdID+"."+k] = v
				}
			}
		}
		s = strings.TrimLeft(s[end+1:], " ")
	}
	return sd, s
}

// splitQuoted splits "a=\"x y\" b=z" honouring double quotes.
func splitQuoted(s string) []string {
	var out []string
	var cur strings.Builder
	inQuotes := false
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c == '"':
			inQuotes = !inQuotes
			cur.WriteByte(c)
		case c == ' ' && !inQuotes:
			if cur.Len() > 0 {
				out = append(out, cur.String())
				cur.Reset()
			}
		default:
			cur.WriteByte(c)
		}
	}
	if cur.Len() > 0 {
		out = append(out, cur.String())
	}
	return out
}

func parseRFC5424Time(s string) time.Time {
	if s == "-" || s == "" {
		return time.Now().UTC()
	}
	// Try variants: with fractional seconds, with offset.
	layouts := []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02T15:04:05.000Z07:00",
		"2006-01-02T15:04:05Z",
	}
	for _, layout := range layouts {
		if t, err := time.Parse(layout, s); err == nil {
			return t.UTC()
		}
	}
	return time.Now().UTC()
}

// ─── RFC 3164 ────────────────────────────────────────────────────────────────
// <PRI>MMM dd HH:MM:SS HOSTNAME TAG[PID]: MESSAGE
//
// Example:
//   <34>Oct 11 22:14:15 mymachine su: 'su root' failed for lonvick on /dev/pts/8

func tryRFC3164(raw, sourceTag string) (storage.LogEvent, bool) {
	if len(raw) < 5 || raw[0] != '<' {
		return storage.LogEvent{}, false
	}
	end := strings.IndexByte(raw, '>')
	if end <= 1 || end > 5 {
		return storage.LogEvent{}, false
	}
	pri, err := strconv.Atoi(raw[1:end])
	if err != nil || pri < 0 || pri > 191 {
		return storage.LogEvent{}, false
	}
	rest := raw[end+1:]

	// Try to read "MMM dd HH:MM:SS " (15 chars + space)
	if len(rest) < 16 {
		return storage.LogEvent{}, false
	}
	tsStr := rest[:15]
	ts, err := time.Parse("Jan _2 15:04:05", tsStr)
	if err != nil {
		// Some devices use a different separator or padding — try "Jan 2"
		ts, err = time.Parse("Jan 2 15:04:05", tsStr)
		if err != nil {
			return storage.LogEvent{}, false
		}
	}
	// RFC 3164 omits year — assume current
	now := time.Now().UTC()
	ts = time.Date(now.Year(), ts.Month(), ts.Day(), ts.Hour(), ts.Minute(), ts.Second(), 0, time.UTC)
	// If parsed timestamp is in the future, assume previous year wrap
	if ts.After(now.Add(48 * time.Hour)) {
		ts = ts.AddDate(-1, 0, 0)
	}

	rest = strings.TrimLeft(rest[15:], " ")
	host, rest := readToken(rest)
	tag, rest := readSyslogTag(rest)
	procID := ""
	if br := strings.IndexByte(tag, '['); br > 0 && strings.HasSuffix(tag, "]") {
		procID = tag[br+1 : len(tag)-1]
		tag = tag[:br]
	}
	msg := strings.TrimPrefix(rest, ": ")
	msg = strings.TrimPrefix(msg, ":")
	msg = strings.TrimSpace(msg)

	return storage.LogEvent{
		EventID:   uuid.NewString(),
		Timestamp: ts,
		Host:      host,
		AgentID:   "syslog:" + sourceTag,
		Source:    "syslog",
		Level:     severityFromPri(pri),
		Message:   msg,
		Service:   tag,
		Meta: map[string]any{
			"syslog.facility": facilityFromPri(pri),
			"syslog.priority": pri,
			"syslog.version":  "3164",
			"proc_id":         procID,
		},
	}, true
}

func readToken(s string) (string, string) {
	idx := strings.IndexByte(s, ' ')
	if idx == -1 {
		return s, ""
	}
	return s[:idx], s[idx+1:]
}

// readSyslogTag returns everything up to but not including the first ":"
// or whitespace (whichever comes first). Per RFC 3164 the tag may include
// the PID in brackets ("sshd[1234]").
func readSyslogTag(s string) (string, string) {
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c == ':' || c == ' ' {
			return s[:i], s[i:]
		}
	}
	return s, ""
}

func cleanNil(s string) string {
	if s == "-" {
		return ""
	}
	return s
}

func makeUnstructured(raw, sourceTag string) storage.LogEvent {
	return storage.LogEvent{
		EventID:   uuid.NewString(),
		Timestamp: time.Now().UTC(),
		Source:    "syslog",
		AgentID:   "syslog:" + sourceTag,
		Level:     "info",
		Message:   raw,
		Meta: map[string]any{
			"syslog.version": "unparsed",
			"raw_length":     fmt.Sprintf("%d", len(raw)),
		},
	}
}
