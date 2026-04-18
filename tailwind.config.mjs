/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        priority: {
          p0: "#dc2626",
          p1: "#ea580c",
          p2: "#ca8a04",
        },
      },
    },
  },
  plugins: [],
};
