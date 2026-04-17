/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // URSUS Insight SIEM — Modern Cyberpunk in the Forest
        vault: {
          50:  "#f3e8ff",
          100: "#e5ccff",
          200: "#cc99ff",
          300: "#b266ff",
          400: "#BF40BF",   // Neon Violet accent
          500: "#8b20d1",
          600: "#6A0DAD",   // Deep Purple — main
          700: "#520a88",
          800: "#3a0763",
          900: "#28054a",
          950: "#0e0220",
        },
        siem: {
          bg:          "#08090e",
          surface:     "#0d0f18",
          surface2:    "#111520",
          border:      "#1a0d2e",
          "border-2":  "#2d1860",
          purple:      "#6A0DAD",
          "purple-l":  "#8b20d1",
          "purple-d":  "#4a0878",
          violet:      "#BF40BF",
          "violet-l":  "#d060d0",
          "violet-d":  "#9a2e9a",
          slate:       "#2F4F4F",
          "slate-l":   "#3d6565",
          "slate-d":   "#1e3333",
          glow:        "rgba(106,13,173,0.18)",
          "glow-v":    "rgba(191,64,191,0.15)",
        },
      },
      boxShadow: {
        siem:    "0 0 24px rgba(106,13,173,0.18), 0 2px 8px rgba(0,0,0,0.6)",
        "siem-v":"0 0 24px rgba(191,64,191,0.18), 0 2px 8px rgba(0,0,0,0.6)",
        "siem-inner": "inset 0 1px 0 rgba(191,64,191,0.08)",
      },
      backgroundImage: {
        "siem-gradient": "linear-gradient(135deg, #08090e 0%, #0d0a18 50%, #090e10 100%)",
        "siem-card":     "linear-gradient(145deg, #0d0f18 0%, #111520 100%)",
        "siem-purple":   "linear-gradient(135deg, #6A0DAD 0%, #BF40BF 100%)",
        "siem-header":   "linear-gradient(90deg, #08090e 0%, #0f0d1a 50%, #090e10 100%)",
      },
      animation: {
        "pulse-slow": "pulse 3s ease-in-out infinite",
        "glow-pulse": "glowPulse 2s ease-in-out infinite",
      },
      keyframes: {
        glowPulse: {
          "0%, 100%": { boxShadow: "0 0 5px rgba(106,13,173,0.3)" },
          "50%":      { boxShadow: "0 0 20px rgba(106,13,173,0.7)" },
        },
      },
    },
  },
  plugins: [],
};
