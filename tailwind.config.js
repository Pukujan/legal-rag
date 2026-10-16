/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: {
          950: "#050a16",
          900: "#0a1226",
          800: "#101a33",
          700: "#182446",
          600: "#243257",
        },
        ink: {
          DEFAULT: "#eef2fb",
          dim: "#c2cbe0",
          mute: "#8f9cba",
        },
        cyan: {
          DEFAULT: "#4fd6e8",
          soft: "#9fe8f2",
        },
        gold: {
          DEFAULT: "#e8c06a",
          deep: "#c99a3d",
        },
        ok: "#5ac98d",
        bad: "#e4878f",
        pending: "#7c89a6",
      },
      fontFamily: {
        serif: ['"Iowan Old Style"', '"Palatino Linotype"', "Palatino", "Georgia", "serif"],
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
      maxWidth: {
        prose: "68ch",
      },
      keyframes: {
        "fade-rise": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "halo-pulse": {
          "0%,100%": { opacity: "0.45" },
          "50%": { opacity: "0.9" },
        },
      },
      animation: {
        "fade-rise": "fade-rise 320ms ease-out both",
        "halo-pulse": "halo-pulse 2.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
