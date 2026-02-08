/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        'lochcad': {
          bg: '#1b1f2b',
          surface: '#232838',
          panel: '#1a3a5c',
          accent: '#2176B7',
          'accent-hover': '#2b8ad4',
          'accent-warm': '#F58A13',
          'accent-warm-hover': '#ffa033',
          text: '#eaeaea',
          'text-dim': '#8892a4',
          grid: '#2a2f40',
          wire: '#00ff88',
          bus: '#F58A13',
          copper: '#b87333',
          board: '#2d5016',
          'board-perf': '#8B7355',
          pin: '#aaaaaa',
          selected: '#4fc3f7',
          error: '#ff5252',
          warning: '#F58A13',
          success: '#69f0ae',
        }
      },
      fontFamily: {
        'mono': ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
};
