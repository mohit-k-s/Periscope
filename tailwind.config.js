/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        aws: {
          dark: '#0f172a',
          card: '#1e293b',
          border: '#334155',
          orange: '#ff9900',
          blue: '#0073bb',
          hover: '#2a3b53',
        },
        pi: {
          cpu: '#10b981',        // Vibrant Green (CPU)
          io: '#3b82f6',         // Vibrant Blue (Disk / EBS IO)
          lock: '#ef4444',       // Crimson Red (Lock / Row / Table contention)
          concurrency: '#8b5cf6',// Purple (Buffer / Latches)
          network: '#f59e0b',    // Amber (Client / Network)
          other: '#6b7280',      // Gray (Other wait events)
        }
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Menlo', 'Monaco', 'Courier New', 'monospace'],
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      }
    },
  },
  plugins: [],
};
