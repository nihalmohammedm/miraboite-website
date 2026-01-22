throw new Error("TAILWIND CONFIG IS BEING READ");


export default {
  content: ["./src/**/*.{astro,html,js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        testred: "#ff0000",
      },
      fontFamily: {
        goudy: ["'Sorts Mill Goudy'", "serif"],
      },
    },
  },
};
