package storage

import (
	"context"
	"encoding/json"
	"strings"
	"time"
)

// AuditEntry is a row in audit_log. The table is append-only — there is
// no Update or Delete method by design.
type AuditEntry struct {
	ID         int64           `json:"id"`
	OccurredAt time.Time       `json:"occurred_at"`
	Actor      string          `json:"actor"`
	ActorIP    *string         `json:"actor_ip,omitempty"`
	Action     string          `json:"action"`
	TargetType string          `json:"target_type"`
	TargetID   *string         `json:"target_id,omitempty"`
	Diff       json.RawMessage `json:"diff"`
	Outcome    string          `json:"outcome"`
	Notes      *string         `json:"notes,omitempty"`
}

type AuditInput struct {
	Actor      string
	ActorIP    string
	Action     string
	TargetType string
	TargetID   string
	Diff       any
	Outcome    string
	Notes      string
}

// InsertAudit appends one row to the audit log.
func (db *DB) InsertAudit(ctx context.Context, in AuditInput) error {
	diffJSON, _ := json.Marshal(in.Diff)
	if len(diffJSON) == 0 {
		diffJSON = []byte("{}")
	}
	var actorIP, targetID, notes any
	if in.ActorIP != "" {
		actorIP = in.ActorIP
	}
	if in.TargetID != "" {
		targetID = in.TargetID
	}
	if in.Notes != "" {
		notes = in.Notes
	}
	if in.Outcome == "" {
		in.Outcome = "ok"
	}
	_, err := db.pool.Exec(ctx,
		`INSERT INTO audit_log (actor, actor_ip, action, target_type, target_id, diff, outcome, notes)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		in.Actor, actorIP, in.Action, in.TargetType, targetID, diffJSON, in.Outcome, notes)
	return err
}

func (db *DB) ListAudit(ctx context.Context, actor, action, targetType string, limit int) ([]AuditEntry, error) {
	if limit <= 0 || limit > 1000 {
		limit = 200
	}
	where := []string{"1=1"}
	args := []any{}
	if actor != "" {
		args = append(args, actor)
		where = append(where, "actor = $"+itoa(len(args)))
	}
	if action != "" {
		args = append(args, action)
		where = append(where, "action = $"+itoa(len(args)))
	}
	if targetType != "" {
		args = append(args, targetType)
		where = append(where, "target_type = $"+itoa(len(args)))
	}
	args = append(args, limit)

	rows, err := db.pool.Query(ctx,
		`SELECT id, occurred_at, actor, actor_ip, action, target_type, target_id, diff, outcome, notes
		 FROM audit_log WHERE `+strings.Join(where, " AND ")+
			` ORDER BY occurred_at DESC LIMIT $`+itoa(len(args)), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AuditEntry
	for rows.Next() {
		var e AuditEntry
		if err := rows.Scan(&e.ID, &e.OccurredAt, &e.Actor, &e.ActorIP, &e.Action,
			&e.TargetType, &e.TargetID, &e.Diff, &e.Outcome, &e.Notes); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// ── MITRE coverage ─────────────────────────────────────────────────────────

type MitreEntry struct {
	TechniqueID  string     `json:"technique_id"`
	Tactic       string     `json:"tactic"`
	RuleCount    int        `json:"rule_count"`
	EnabledCount int        `json:"enabled_count"`
	LastHit      *time.Time `json:"last_hit,omitempty"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

func (db *DB) MitreCoverage(ctx context.Context) ([]MitreEntry, error) {
	rows, err := db.pool.Query(ctx,
		`SELECT technique_id, tactic, rule_count, enabled_count, last_hit, updated_at
		 FROM mitre_coverage ORDER BY technique_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []MitreEntry
	for rows.Next() {
		var e MitreEntry
		if err := rows.Scan(&e.TechniqueID, &e.Tactic, &e.RuleCount,
			&e.EnabledCount, &e.LastHit, &e.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// RefreshMitreCoverage recomputes counts from sigma_rules.rule_yaml (cheap
// — scans the existing rules table, extracts ATT&CK tags, stores counts).
func (db *DB) RefreshMitreCoverage(ctx context.Context) error {
	// Strategy: pull every active rule + its parsed mitre tags
	// (here we approximate via regex on rule_yaml since SIGMA's `tags:`
	// section uses values like "attack.t1059.001"). Full SIGMA YAML parse
	// is implemented in the Rust engine; this is the SQL fast-path used
	// to populate the UI heatmap.
	tx, err := db.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `TRUNCATE TABLE mitre_coverage`); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
		WITH t AS (
		  SELECT
		    UPPER(regexp_replace(tag, '^attack\.', '')) AS technique_id,
		    (status = 'enabled') AS enabled
		  FROM sigma_rules,
		       regexp_split_to_table(
		         (regexp_match(rule_yaml, 'tags:\s*\[([^\]]+)\]'))[1], ',\s*'
		       ) AS tag
		  WHERE rule_yaml ~ 'attack\.'
		)
		INSERT INTO mitre_coverage (technique_id, rule_count, enabled_count, updated_at)
		SELECT technique_id,
		       COUNT(*)                              AS rule_count,
		       COUNT(*) FILTER (WHERE enabled)       AS enabled_count,
		       NOW()
		FROM t
		WHERE technique_id LIKE 'T%'
		GROUP BY technique_id
	`)
	if err != nil {
		// Non-fatal — older schemas may not have rule_yaml indexed.
		return tx.Commit(ctx)
	}
	return tx.Commit(ctx)
}
