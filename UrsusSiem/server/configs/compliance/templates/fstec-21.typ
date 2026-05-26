// Typst template — отчёт по Приказу ФСТЭК №21.
// Рендеринг: typst compile fstec-21.typ output.pdf --input data=$(cat data.json)
//
// Данные подаются через --input data=<JSON> от Go-сервиса reports.go (Sprint 9).

#let data = json("data.json")

#set document(
  title: "Отчёт о соответствии Приказу ФСТЭК России №21",
  author: "URSUS SIEM",
)

#set page(
  paper: "a4",
  margin: 2cm,
  header: align(right)[URSUS SIEM · отчёт],
  footer: align(center)[Стр. #counter(page).display() из #counter(page).final().first()],
)

#set text(font: "DejaVu Sans", lang: "ru", size: 10pt)

// ── Cover ──────────────────────────────────────────────────────────────────
#align(center + horizon)[
  #text(size: 26pt, weight: "bold")[Отчёт о соответствии]
  #v(0.4cm)
  #text(size: 16pt)[Приказу ФСТЭК России №21]
  #v(0.4cm)
  #text(size: 12pt, fill: gray)[«Меры защиты ИСПДн»]
  #v(2cm)
  #text(size: 11pt)[
    Период: #data.period_from — #data.period_to \
    Организация: #data.org_name \
    Сформирован: #data.generated_at \
    URSUS SIEM версия: #data.ursus_version
  ]
]

#pagebreak()

// ── Summary ─────────────────────────────────────────────────────────────────
= Сводка

Из #data.measures_total мер проверено #data.measures_checked, выполнено
#data.measures_compliant, требуется внимание — #data.measures_partial.

#table(
  columns: (auto, 1fr, auto),
  stroke: 0.5pt + gray,
  [*Категория*], [*Описание*], [*Статус*],
  ..for s in data.sections {
    (s.id, s.name, s.summary_status)
  }
)

#pagebreak()

// ── Details ─────────────────────────────────────────────────────────────────
#for section in data.sections [
  = #section.id — #section.name

  #for m in section.measures [
    == #m.id — #m.name

    *Статус:* #m.status \
    *Проверка:* #m.check

    #if m.evidence_value != none [
      *Доказательство:*
      #raw(m.evidence_value)
    ]

    #v(0.5cm)
  ]
]
