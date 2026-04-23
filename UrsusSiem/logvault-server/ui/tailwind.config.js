/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // URSUS SIEM — Apple Minimalism Style with Purple Accent
        vault: {
          50:  "#f9f5ff",
          100: "#f3e8ff",
          200: "#e9d5ff",
          300: "#d8b4fe",
          400: "#a78bfa",   // Professional purple accent
          500: "#9f7aea",
          600: "#8b5cf6",
          700: "#7c3aed",
          800: "#6d28d9",
          900: "#5b21b6",
          950: "#3f0f62",
        },
        siem: {
          bg:          "#111827",   // Lighter dark background
          surface:     "#1f2937",   // Card surface
          /* Must track index.css :root / [data-theme="light"] — fixed hex breaks light theme */
          surface2:    "var(--surface-2)",
          border:      "#4b5563",   // Neutral gray border
          "border-2":  "#6b7280",   // Lighter border
          purple:      "#a78bfa",   // Professional purple
          "purple-l":  "#c4b5fd",
          "purple-d":  "#8b5cf6",
          violet:      "#a78bfa",   // No more neon
          "violet-l":  "#c4b5fd",
          "violet-d":  "#8b5cf6",
          slate:       "#6b7280",
          "slate-l":   "#9ca3af",
          "slate-d":   "#4b5563",
          glow:        "rgba(167, 139, 250, 0.08)",
          "glow-v":    "rgba(167, 139, 250, 0.08)",
        },
      },
      boxShadow: {
        siem:    "0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06)",
        "siem-v":"0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06)",
        "siem-inner": "inset 0 1px 0 rgba(255,255,255,0.05)",
      },
      backgroundImage: {
        "siem-gradient": "linear-gradient(135deg, #111827 0%, #1f2937 100%)",
        "siem-card":     "linear-gradient(145deg, #1f2937 0%, #111827 100%)",
        "siem-purple":   "linear-gradient(135deg, #a78bfa 0%, #8b5cf6 100%)",
        "siem-header":   "linear-gradient(90deg, #111827 0%, #1f2937 100%)",
      },
      animation: {
        "pulse-slow": "pulse 3s ease-in-out infinite",
      },
      keyframes: {},
    },
  },
  plugins: [],
};
