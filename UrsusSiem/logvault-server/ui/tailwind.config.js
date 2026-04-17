/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // URSUS SIEM — Modern dark-neutral (enterprise/SaaS aesthetic)
        vault: {
          50:  "#f0f6ff",
          100: "#dbeafe",
          200: "#bfdbfe",
          300: "#93c5fd",
          400: "#60a5fa",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
          800: "#1e40af",
          900: "#1e3a8a",
          950: "#172554",
        },
        siem: {
          bg:          "#0d1117",
          surface:     "#161b22",
          surface2:    "#1c2128",
          border:      "#21262d",
          "border-2":  "#30363d",
          purple:      "#388bfd",
          "purple-l":  "#58a6ff",
          "purple-d":  "#1f6feb",
          violet:      "#58a6ff",
          "violet-l":  "#79c0ff",
          "violet-d":  "#388bfd",
          slate:       "#2d333b",
          "slate-l":   "#373e47",
          "slate-d":   "#22272e",
          glow:        "rgba(56,139,253,0.12)",
          "glow-v":    "rgba(88,166,255,0.10)",
        },
      },
      boxShadow: {
        siem:    "0 1px 3px rgba(0,0,0,0.4), 0 1px 2px rgba(0,0,0,0.3)",
        "siem-v":"0 1px 3px rgba(0,0,0,0.4), 0 1px 2px rgba(0,0,0,0.3)",
        "siem-inner": "inset 0 1px 0 rgba(255,255,255,0.04)",
      },
      backgroundImage: {
        "siem-gradient": "linear-gradient(180deg, #0d1117 0%, #161b22 100%)",
        "siem-card":     "linear-gradient(180deg, #161b22 0%, #1c2128 100%)",
        "siem-purple":   "linear-gradient(135deg, #1f6feb 0%, #388bfd 100%)",
        "siem-header":   "linear-gradient(180deg, #0d1117 0%, #161b22 100%)",
      },
      animation: {
        "pulse-slow": "pulse 3s ease-in-out infinite",
        "glow-pulse": "glowPulse 2s ease-in-out infinite",
      },
      keyframes: {
        glowPulse: {
          "0%, 100%": { boxShadow: "0 0 4px rgba(56,139,253,0.2)" },
          "50%":      { boxShadow: "0 0 8px rgba(56,139,253,0.4)" },
        },
      },
    },
  },
  plugins: [],
};
