/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: '#0F0F1A',
          soft: '#1F1F2E',
        },
        paper: {
          DEFAULT: '#FFFFFF',
          subtle: '#F8F7FB',
          warm: '#FAFAFA',
        },
        bone: '#FFFFFF',
        rule: '#ECEAF3',
        mute: {
          DEFAULT: '#4A4A55',
          soft: '#7A7A88',
        },
        accent: {
          DEFAULT: '#7C3AED',
          soft: '#A855F7',
          deep: '#5B21B6',
          tint: '#F3EDFF',
          ring: '#C4B5FD',
        },
      },
      fontFamily: {
        display: ['"Playfair Display"', 'Didot', '"Bodoni 72"', '"Times New Roman"', 'serif'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        'display-xl': ['36px', { lineHeight: '40px', letterSpacing: '-0.02em' }],
        'display-lg': ['30px', { lineHeight: '34px', letterSpacing: '-0.015em' }],
        display: ['22px', { lineHeight: '28px', letterSpacing: '-0.005em' }],
        h2: ['16px', { lineHeight: '22px', letterSpacing: '0' }],
        body: ['13px', { lineHeight: '20px', letterSpacing: '0' }],
        caption: ['12px', { lineHeight: '17px', letterSpacing: '0.01em' }],
        label: ['10px', { lineHeight: '14px', letterSpacing: '0.14em' }],
        meta: ['10.5px', { lineHeight: '14px', letterSpacing: '0.06em' }],
      },
      letterSpacing: {
        editorial: '0.14em',
        cta: '0.08em',
        meta: '0.06em',
      },
      spacing: {
        hair: '1px',
        '4.5': '18px',
        '7.5': '30px',
      },
      borderWidth: {
        hair: '1px',
      },
      borderRadius: {
        none: '0',
        xs: '4px',
        sm: '8px',
        card: '14px',
        lg: '20px',
        pill: '9999px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(15,15,26,0.04), 0 8px 24px rgba(124,58,237,0.06)',
        'card-lg': '0 4px 12px rgba(15,15,26,0.06), 0 16px 40px rgba(124,58,237,0.1)',
        cta: '0 4px 14px rgba(124,58,237,0.35)',
        'cta-lg': '0 6px 20px rgba(124,58,237,0.45)',
      },
      backgroundImage: {
        'cta-gradient': 'linear-gradient(135deg, #7C3AED 0%, #A855F7 100%)',
        'cta-gradient-hover': 'linear-gradient(135deg, #6D28D9 0%, #9333EA 100%)',
        'tint-gradient': 'linear-gradient(135deg, #F3EDFF 0%, #FDF8FF 100%)',
      },
      transitionTimingFunction: {
        editorial: 'cubic-bezier(0.2, 0.6, 0.2, 1)',
        reveal: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      transitionDuration: {
        140: '140ms',
        200: '200ms',
        320: '320ms',
        480: '480ms',
      },
      keyframes: {
        'reveal-blur': {
          '0%': { opacity: '0', filter: 'blur(8px)', transform: 'translateY(4px)' },
          '100%': { opacity: '1', filter: 'blur(0px)', transform: 'translateY(0)' },
        },
        'underline-grow': {
          '0%': { transform: 'scaleX(0)' },
          '100%': { transform: 'scaleX(1)' },
        },
        'fade-rise': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: '0.45' },
          '50%': { opacity: '1' },
        },
      },
      animation: {
        'reveal-blur': 'reveal-blur 480ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'underline-grow': 'underline-grow 320ms cubic-bezier(0.2, 0.6, 0.2, 1) both',
        'fade-rise': 'fade-rise 200ms cubic-bezier(0.2, 0.6, 0.2, 1) both',
        'pulse-soft': 'pulse-soft 1.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
