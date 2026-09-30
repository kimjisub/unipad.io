import type { Config } from 'tailwindcss'

// Theme colors are hex CSS variables, so opacity modifiers (e.g. `bg-card/50`) need color-mix.
const withAlpha = (variable: string) =>
  `color-mix(in srgb, var(${variable}) calc(<alpha-value> * 100%), transparent)`

const config: Config = {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: withAlpha('--background'),
        foreground: withAlpha('--foreground'),
        primary: {
          DEFAULT: withAlpha('--primary'),
          foreground: withAlpha('--primary-foreground'),
        },
        secondary: {
          DEFAULT: withAlpha('--secondary'),
          foreground: withAlpha('--secondary-foreground'),
        },
        muted: {
          DEFAULT: withAlpha('--muted'),
          foreground: withAlpha('--muted-foreground'),
        },
        accent: {
          DEFAULT: withAlpha('--accent'),
          foreground: withAlpha('--accent-foreground'),
        },
        card: {
          DEFAULT: withAlpha('--card'),
          foreground: withAlpha('--card-foreground'),
        },
        border: withAlpha('--border'),
        ring: withAlpha('--ring'),
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic': 'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
      },
      fontFamily: {
        // Only the web player defines --font-sans (`.font-inter` in globals.css); other pages fall back to the system font.
        sans: ['var(--font-sans, system-ui)', 'system-ui', 'sans-serif'],
        serif: ['var(--font-serif)', 'Georgia', 'serif'],
      },
      keyframes: {
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in-scale': {
          '0%': { opacity: '0', transform: 'scale(0.9)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'blob-1': {
          '0%, 100%': { 
            transform: 'translate(0, 0) scale(1) rotate(0deg)',
          },
          '25%': { 
            transform: 'translate(30px, -50px) scale(1.1) rotate(5deg)',
          },
          '50%': { 
            transform: 'translate(-20px, 20px) scale(0.95) rotate(-5deg)',
          },
          '75%': { 
            transform: 'translate(40px, 30px) scale(1.05) rotate(3deg)',
          },
        },
        'blob-2': {
          '0%, 100%': { 
            transform: 'translate(0, 0) scale(1) rotate(0deg)',
          },
          '25%': { 
            transform: 'translate(-40px, 30px) scale(1.15) rotate(-3deg)',
          },
          '50%': { 
            transform: 'translate(30px, -40px) scale(0.9) rotate(8deg)',
          },
          '75%': { 
            transform: 'translate(-20px, -30px) scale(1.1) rotate(-5deg)',
          },
        },
        'blob-3': {
          '0%, 100%': { 
            transform: 'translate(0, 0) scale(1) rotate(0deg)',
          },
          '25%': { 
            transform: 'translate(50px, 20px) scale(0.95) rotate(7deg)',
          },
          '50%': { 
            transform: 'translate(-30px, -50px) scale(1.1) rotate(-4deg)',
          },
          '75%': { 
            transform: 'translate(20px, 40px) scale(1.05) rotate(2deg)',
          },
        },
      },
      animation: {
        'fade-in-up': 'fade-in-up 0.5s ease-out forwards',
        'fade-in-scale': 'fade-in-scale 0.5s ease-out forwards',
        shimmer: 'shimmer 2s linear infinite',
        'blob-1': 'blob-1 25s ease-in-out infinite',
        'blob-2': 'blob-2 30s ease-in-out infinite',
        'blob-3': 'blob-3 35s ease-in-out infinite',
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
}
export default config
