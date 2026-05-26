package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gopkg.in/yaml.v3"
)

// Sprint 9 — compliance report generator.
//
// Walks a YAML profile (configs/compliance/<name>.yaml), runs the
// evidence_query against the DB, and renders a PDF via `typst` using the
// matching template under configs/compliance/templates/.
//
// Endpoints:
//   GET /api/compliance/profiles            — list available profiles
//   GET /api/compliance/:name/preview       — JSON evidence dump (no PDF)
//   GET /api/compliance/:name/pdf?from=...  — full PDF report
//
// `typst` must be on PATH (apt install typst-cli or download from
// https://github.com/typst/typst/releases).

type complianceProfile struct {
	Reference string             `yaml:"reference"`
	Target    string             `yaml:"target"`
	Sections  []complianceSection `yaml:"sections"`
}

type complianceSection struct {
	ID       string             `yaml:"id"`
	Name     string             `yaml:"name"`
	Measures []complianceMeasure `yaml:"measures"`
}

type complianceMeasure struct {
	ID            string `yaml:"id"`
	Name          string `yaml:"name"`
	Check         string `yaml:"check"`
	EvidenceQuery string `yaml:"evidence_query"`
	Evidence      string `yaml:"evidence"`
}

func complianceDir() string {
	if d := os.Getenv("URSUS_COMPLIANCE_DIR"); d != "" {
		return d
	}
	return "/etc/ursus/compliance"
}

func (h *Handler) ListComplianceProfiles(c *gin.Context) {
	entries, err := os.ReadDir(complianceDir())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	out := []string{}
	for _, e := range entries {
		n := e.Name()
		if strings.HasSuffix(n, ".yaml") || strings.HasSuffix(n, ".yml") {
			out = append(out, strings.TrimSuffix(strings.TrimSuffix(n, ".yaml"), ".yml"))
		}
	}
	c.JSON(http.StatusOK, gin.H{"profiles": out})
}

func (h *Handler) PreviewCompliance(c *gin.Context) {
	data, err := h.runComplianceProfile(c.Request.Context(), c.Param("name"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, data)
}

func (h *Handler) ComplianceReportPDF(c *gin.Context) {
	data, err := h.runComplianceProfile(c.Request.Context(), c.Param("name"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	pdf, err := renderTypst(c.Request.Context(), c.Param("name"), data)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": err.Error(),
			"hint":  "Install typst-cli on the URSUS host (apt install typst-cli)",
		})
		return
	}
	c.Header("Content-Disposition",
		fmt.Sprintf("attachment; filename=\"ursus-%s-%s.pdf\"",
			c.Param("name"), time.Now().Format("2006-01-02")))
	c.Data(http.StatusOK, "application/pdf", pdf)
}

func (h *Handler) runComplianceProfile(ctx context.Context, name string) (map[string]any, error) {
	if strings.ContainsAny(name, "/\\.") {
		return nil, fmt.Errorf("invalid profile name")
	}
	path := filepath.Join(complianceDir(), name+".yaml")
	body, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var prof complianceProfile
	if err := yaml.Unmarshal(body, &prof); err != nil {
		return nil, err
	}

	totals := struct{ checked, compliant, partial int }{}
	sections := make([]map[string]any, 0, len(prof.Sections))
	for _, s := range prof.Sections {
		measures := make([]map[string]any, 0, len(s.Measures))
		for _, m := range s.Measures {
			totals.checked++
			ev := m.Evidence
			status := "compliant"
			if m.EvidenceQuery != "" {
				v, qerr := h.runEvidenceQuery(ctx, m.EvidenceQuery)
				if qerr != nil {
					status = "partial"
					ev = "запрос вернул ошибку: " + qerr.Error()
					totals.partial++
				} else {
					ev = v
					totals.compliant++
				}
			} else if ev != "" {
				totals.compliant++
			} else {
				status = "partial"
				totals.partial++
			}
			measures = append(measures, map[string]any{
				"id":             m.ID,
				"name":           m.Name,
				"check":          m.Check,
				"status":         status,
				"evidence_value": ev,
			})
		}
		sections = append(sections, map[string]any{
			"id":             s.ID,
			"name":           s.Name,
			"measures":       measures,
			"summary_status": "ok",
		})
	}

	return map[string]any{
		"reference":           prof.Reference,
		"target":              prof.Target,
		"period_from":         time.Now().AddDate(0, -3, 0).Format("2006-01-02"),
		"period_to":           time.Now().Format("2006-01-02"),
		"org_name":            os.Getenv("URSUS_ORG_NAME"),
		"generated_at":        time.Now().Format(time.RFC3339),
		"ursus_version":       "2.0.0",
		"measures_total":      totals.checked,
		"measures_checked":    totals.checked,
		"measures_compliant":  totals.compliant,
		"measures_partial":    totals.partial,
		"sections":            sections,
	}, nil
}

// runEvidenceQuery executes a SELECT statement and returns a compact
// summary suitable for the PDF.
func (h *Handler) runEvidenceQuery(ctx context.Context, sql string) (string, error) {
	pool := h.db.PoolForJobs()
	if pool == nil {
		return "", fmt.Errorf("DB pool unavailable")
	}
	rows, err := pool.Query(ctx, sql)
	if err != nil {
		return "", err
	}
	defer rows.Close()

	cols := rows.FieldDescriptions()
	colNames := make([]string, len(cols))
	for i, c := range cols {
		colNames[i] = string(c.Name)
	}

	var out []map[string]any
	for rows.Next() {
		vals, _ := rows.Values()
		row := make(map[string]any, len(colNames))
		for i, n := range colNames {
			if i < len(vals) {
				row[n] = vals[i]
			}
		}
		out = append(out, row)
		if len(out) >= 50 {
			break
		}
	}
	b, _ := json.MarshalIndent(out, "", "  ")
	return string(b), nil
}

func renderTypst(ctx context.Context, profile string, data map[string]any) ([]byte, error) {
	tplDir := filepath.Join(complianceDir(), "templates")
	tpl := filepath.Join(tplDir, profile+".typ")
	if _, err := os.Stat(tpl); err != nil {
		return nil, fmt.Errorf("template not found: %s", tpl)
	}
	tmp, err := os.MkdirTemp("", "ursus-typst-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(tmp)

	// Typst reads sibling JSON via `json("data.json")` — write it next to
	// a copy of the template.
	dataJSON, _ := json.Marshal(data)
	if err := os.WriteFile(filepath.Join(tmp, "data.json"), dataJSON, 0o644); err != nil {
		return nil, err
	}
	tplBody, _ := os.ReadFile(tpl)
	if err := os.WriteFile(filepath.Join(tmp, "report.typ"), tplBody, 0o644); err != nil {
		return nil, err
	}

	outPath := filepath.Join(tmp, "report.pdf")
	cmd := exec.CommandContext(ctx, "typst", "compile", "report.typ", "report.pdf")
	cmd.Dir = tmp
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("typst: %w (%s)", err, stderr.String())
	}
	return os.ReadFile(outPath)
}
