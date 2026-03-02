/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/routes/public/settings-page/**/*.{ts,tsx}",
    "./src/routes/public/history-page/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [require("@tailwindcss/typography")],
};
