package syslog

import (
	"strings"
	"testing"
)

func TestParseRFC5424_minimal(t *testing.T) {
	raw := `<34>1 2026-05-24T22:14:15.003Z mymachine.example.com su - ID47 - 'su root' failed for lonvick on /dev/pts/8`
	ev := Parse(raw, "10.0.0.1")
	if ev.Host != "mymachine.example.com" {
		t.Errorf("host = %q, want mymachine.example.com", ev.Host)
	}
	if ev.Service != "su" {
		t.Errorf("service = %q, want su", ev.Service)
	}
	if ev.Level != "critical" {
		t.Errorf("level = %q, want critical (pri 34 = auth.crit)", ev.Level)
	}
	if !strings.Contains(ev.Message, "lonvick") {
		t.Errorf("message missing payload: %q", ev.Message)
	}
	if ev.Meta["syslog.version"] != "5424" {
		t.Errorf("version meta = %v", ev.Meta["syslog.version"])
	}
}

func TestParseRFC5424_structuredData(t *testing.T) {
	raw := `<165>1 2026-05-24T22:14:15Z server1 app - - [origin ip="192.0.2.1" software="abc"] message body`
	ev := Parse(raw, "10.0.0.2")
	if got := ev.Meta["sd.origin.ip"]; got != "192.0.2.1" {
		t.Errorf("sd.origin.ip = %v, want 192.0.2.1", got)
	}
	if ev.Message != "message body" {
		t.Errorf("message = %q", ev.Message)
	}
}

func TestParseRFC3164_basic(t *testing.T) {
	raw := `<13>Oct 11 22:14:15 host1 sshd[1234]: Failed password for root from 1.2.3.4`
	ev := Parse(raw, "10.0.0.3")
	if ev.Host != "host1" {
		t.Errorf("host = %q", ev.Host)
	}
	if ev.Service != "sshd" {
		t.Errorf("service = %q", ev.Service)
	}
	if ev.Meta["proc_id"] != "1234" {
		t.Errorf("proc_id = %v", ev.Meta["proc_id"])
	}
	if !strings.Contains(ev.Message, "Failed password") {
		t.Errorf("message: %q", ev.Message)
	}
	if ev.Meta["syslog.version"] != "3164" {
		t.Errorf("version = %v", ev.Meta["syslog.version"])
	}
}

func TestParse_unparseable_keepsRaw(t *testing.T) {
	raw := "this is a random line without PRI"
	ev := Parse(raw, "10.0.0.4")
	if ev.Message != raw {
		t.Errorf("expected raw kept, got %q", ev.Message)
	}
	if ev.Meta["syslog.version"] != "unparsed" {
		t.Errorf("version = %v", ev.Meta["syslog.version"])
	}
}

func TestParse_emptyLine_yieldsEvent(t *testing.T) {
	ev := Parse("", "x")
	if ev.EventID == "" {
		t.Error("expected event_id even for empty input")
	}
}

func TestSeverityFromPri(t *testing.T) {
	cases := map[int]string{
		0:   "emergency",
		3:   "error",
		6:   "info",
		7:   "debug",
		34:  "critical", // pri 34 = facility 4 (auth) + severity 2 (critical)
		165: "notice",   // pri 165 = facility 20 + severity 5
	}
	for pri, want := range cases {
		if got := severityFromPri(pri); got != want {
			t.Errorf("severityFromPri(%d) = %q, want %q", pri, got, want)
		}
	}
}
