/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}'
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: {
          primary: '#0f0f1a',
          secondary: '#1a1a2e',
          tertiary: '#1e1e2e',
          card: '#252540',
          hover: '#2d2d4a'
        },
        accent: {
          primary: '#00d4aa',
          secondary: '#ff6b6b',
          tertiary: '#7c3aed',
          gold: '#fbbf24'
        },
        text: {
          primary: '#f8fafc',
          secondary: '#cbd5e1',
          muted: '#64748b'
        },
        border: {
          light: '#334155',
          medium: '#475569'
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace']
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.4s ease-out',
        'wave': 'wave 1.5s ease-in-out infinite',
        'shimmer': 'shimmer 2s linear infinite'
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' }
        },
        slideUp: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' }
        },
        wave: {
          '0%, 100%': { transform: 'scaleY(1)' },
          '50%': { transform: 'scaleY(0.3)' }
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' }
        }
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'mesh-gradient': 'linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%)'
      }
    }
  },
  plugins: []
}