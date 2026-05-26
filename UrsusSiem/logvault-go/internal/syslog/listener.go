package syslog

import (
	"bufio"
	"context"
	"errors"
	"log/slog"
	"net"
	"sync"
	"time"

	"github.com/ursus-siem/logvault-go/internal/storage"
)

// Listener accepts syslog over UDP and TCP, parses each line, and pushes
// the resulting events to the supplied Sink (typically the same ingest
// pipeline used by /api/ingest).
type Listener struct {
	UDPAddr     string         // e.g. ":514" — empty disables UDP
	TCPAddr     string         // e.g. ":514" — empty disables TCP
	ReadTimeout time.Duration  // per-connection idle timeout
	BatchSize   int            // events per Sink.Ingest call (default 200)
	FlushAfter  time.Duration  // max delay before flushing a partial batch
	Sink        Sink           // where parsed events go
}

// Sink is implemented by anything that can take a batch of LogEvents.
// In production this is *Handler.bulkIndex; in tests — a slice append.
type Sink interface {
	Ingest(ctx context.Context, events []storage.LogEvent)
}

// SinkFunc adapts a plain function to Sink.
type SinkFunc func(ctx context.Context, events []storage.LogEvent)

func (f SinkFunc) Ingest(ctx context.Context, events []storage.LogEvent) { f(ctx, events) }

// Run starts UDP + TCP listeners (whichever are configured) and blocks
// until ctx is cancelled. It is safe to call once; for restart create a
// new Listener.
func (l *Listener) Run(ctx context.Context) error {
	if l.Sink == nil {
		return errors.New("syslog.Listener: Sink is nil")
	}
	if l.BatchSize <= 0 {
		l.BatchSize = 200
	}
	if l.FlushAfter <= 0 {
		l.FlushAfter = 500 * time.Millisecond
	}
	if l.ReadTimeout <= 0 {
		l.ReadTimeout = 60 * time.Second
	}

	batch := newBatcher(l.Sink, l.BatchSize, l.FlushAfter)
	go batch.run(ctx)

	var wg sync.WaitGroup
	var firstErr error
	var errMu sync.Mutex
	setErr := func(e error) {
		errMu.Lock()
		defer errMu.Unlock()
		if firstErr == nil {
			firstErr = e
		}
	}

	if l.UDPAddr != "" {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := l.serveUDP(ctx, batch); err != nil {
				slog.Error("syslog UDP listener stopped", "error", err)
				setErr(err)
			}
		}()
	}
	if l.TCPAddr != "" {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := l.serveTCP(ctx, batch); err != nil {
				slog.Error("syslog TCP listener stopped", "error", err)
				setErr(err)
			}
		}()
	}

	wg.Wait()
	batch.flush(context.Background())
	return firstErr
}

// ── UDP ─────────────────────────────────────────────────────────────────────

func (l *Listener) serveUDP(ctx context.Context, batch *batcher) error {
	pc, err := net.ListenPacket("udp", l.UDPAddr)
	if err != nil {
		return err
	}
	defer pc.Close()
	slog.Info("syslog UDP listening", "addr", l.UDPAddr)

	go func() {
		<-ctx.Done()
		_ = pc.Close()
	}()

	buf := make([]byte, 64*1024) // syslog max length per RFC 5426
	for {
		n, addr, err := pc.ReadFrom(buf)
		if err != nil {
			if isClosed(err) {
				return nil
			}
			slog.Warn("syslog UDP read", "error", err)
			continue
		}
		ev := Parse(string(buf[:n]), shortAddr(addr.String()))
		batch.add(ev)
	}
}

// ── TCP ─────────────────────────────────────────────────────────────────────

func (l *Listener) serveTCP(ctx context.Context, batch *batcher) error {
	ln, err := net.Listen("tcp", l.TCPAddr)
	if err != nil {
		return err
	}
	defer ln.Close()
	slog.Info("syslog TCP listening", "addr", l.TCPAddr)

	go func() {
		<-ctx.Done()
		_ = ln.Close()
	}()

	for {
		conn, err := ln.Accept()
		if err != nil {
			if isClosed(err) {
				return nil
			}
			slog.Warn("syslog TCP accept", "error", err)
			continue
		}
		go l.serveTCPConn(ctx, conn, batch)
	}
}

func (l *Listener) serveTCPConn(_ context.Context, conn net.Conn, batch *batcher) {
	defer conn.Close()
	peer := shortAddr(conn.RemoteAddr().String())
	scanner := bufio.NewScanner(conn)
	// Allow long lines (RFC 5425 sets 8KB minimum; some appliances send more)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	for scanner.Scan() {
		_ = conn.SetReadDeadline(time.Now().Add(l.ReadTimeout))
		line := scanner.Text()
		if line == "" {
			continue
		}
		ev := Parse(line, peer)
		batch.add(ev)
	}
}

// ── Batching ────────────────────────────────────────────────────────────────

type batcher struct {
	mu     sync.Mutex
	events []storage.LogEvent
	sink   Sink
	cap    int
	wake   chan struct{}
	max    time.Duration
}

func newBatcher(sink Sink, capacity int, max time.Duration) *batcher {
	return &batcher{
		events: make([]storage.LogEvent, 0, capacity),
		sink:   sink,
		cap:    capacity,
		wake:   make(chan struct{}, 1),
		max:    max,
	}
}

func (b *batcher) add(ev storage.LogEvent) {
	b.mu.Lock()
	b.events = append(b.events, ev)
	full := len(b.events) >= b.cap
	b.mu.Unlock()
	if full {
		select {
		case b.wake <- struct{}{}:
		default:
		}
	}
}

func (b *batcher) flush(ctx context.Context) {
	b.mu.Lock()
	if len(b.events) == 0 {
		b.mu.Unlock()
		return
	}
	out := b.events
	b.events = make([]storage.LogEvent, 0, b.cap)
	b.mu.Unlock()
	b.sink.Ingest(ctx, out)
}

func (b *batcher) run(ctx context.Context) {
	t := time.NewTicker(b.max)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-b.wake:
			b.flush(ctx)
		case <-t.C:
			b.flush(ctx)
		}
	}
}

// ── Helpers ─────────────────────────────────────────────────────────────────

func isClosed(err error) bool {
	if errors.Is(err, net.ErrClosed) {
		return true
	}
	if err == nil {
		return false
	}
	return false
}

// shortAddr drops the port from "ip:port" so it can be used as the
// agent_id tag.
func shortAddr(s string) string {
	if h, _, err := net.SplitHostPort(s); err == nil {
		return h
	}
	return s
}
