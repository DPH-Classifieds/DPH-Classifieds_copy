module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // shadcn/ui design tokens
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        apple: {
          black: '#000000',
          'gray-light': '#f5f5f7',
          'gray-dark': '#272729',
          'gray-dark-2': '#262628',
          'gray-dark-3': '#28282a',
          'gray-dark-4': '#2a2a2d',
          'gray-dark-5': '#242426',
          'near-black': '#1d1d1f',
          blue: '#0071e3',
          'blue-link': '#0066cc',
          'blue-bright': '#2997ff',
          white: '#ffffff',
          'white-80': 'rgba(0, 0, 0, 0.8)',
          'white-48': 'rgba(0, 0, 0, 0.48)',
          'white-32': 'rgba(255, 255, 255, 0.32)',
          overlay: 'rgba(210, 210, 215, 0.64)',
        },
        brand: {
          primary: '#01351c',
          'primary-light': '#014d2a',
          'primary-dark': '#012513',
          secondary: '#4CAF50',
          accent: '#00c853',
        },
      },
      container: {
        center: true,
        padding: '2rem',
      },
      background: {
        DEFAULT: '#000000',
        foreground: '#ffffff',
      },
      fontFamily: {
        'sf-display': ['SF Pro Display', '-apple-system', 'BlinkMacSystemFont', 'Helvetica Neue', 'Helvetica', 'Arial', 'sans-serif'],
        'sf-text': ['SF Pro Text', '-apple-system', 'BlinkMacSystemFont', 'Helvetica Neue', 'Helvetica', 'Arial', 'sans-serif'],
      },
      letterSpacing: {
        'tightest': '-0.28px',
        'tight': '-0.374px',
        'normal': '0',
        'wide': '0.196px',
      },
      lineHeight: {
        'tightest': '1.07',
        'tight': '1.10',
        'normal': '1.14',
        'body': '1.47',
        'button': '2.41',
      },
      borderRadius: {
        'pill': '980px',
        'apple': '8px',
        'apple-sm': '5px',
        'apple-lg': '12px',
        'apple-filter': '11px',
      },
      boxShadow: {
        'apple-card': 'rgba(0, 0, 0, 0.22) 3px 5px 30px 0px',
        'apple-glass': 'rgba(0, 0, 0, 0.22) 3px 5px 30px 0px',
        'brand-glow': '0 4px 24px rgba(1, 53, 28, 0.3)',
      },
      spacing: {
        '18': '4.5rem',
        '22': '5.5rem',
      },
      fontSize: {
        'hero': ['3.5rem', { lineHeight: '1.07', letterSpacing: '-0.28px', fontWeight: '600' }],
        'hero-mobile': ['2.5rem', { lineHeight: '1.07', letterSpacing: '-0.28px', fontWeight: '600' }],
        'section': ['2.5rem', { lineHeight: '1.10', letterSpacing: 'normal', fontWeight: '600' }],
        'tile': ['1.75rem', { lineHeight: '1.14', letterSpacing: '0.196px', fontWeight: '400' }],
        'card-title': ['1.31rem', { lineHeight: '1.19', letterSpacing: '0.231px', fontWeight: '700' }],
        'nav-heading': ['2.13rem', { lineHeight: '1.47', letterSpacing: '-0.374px', fontWeight: '600' }],
        'sub-nav': ['1.5rem', { lineHeight: '1.50', letterSpacing: 'normal', fontWeight: '300' }],
        'body': ['1.06rem', { lineHeight: '1.47', letterSpacing: '-0.374px', fontWeight: '400' }],
        'body-emphasis': ['1.06rem', { lineHeight: '1.24', letterSpacing: '-0.374px', fontWeight: '600' }],
        'button-lg': ['1.13rem', { lineHeight: '1.00', letterSpacing: 'normal', fontWeight: '300' }],
        'button': ['1.06rem', { lineHeight: '2.41', letterSpacing: 'normal', fontWeight: '400' }],
        'link': ['0.88rem', { lineHeight: '1.43', letterSpacing: '-0.224px', fontWeight: '400' }],
        'caption': ['0.88rem', { lineHeight: '1.29', letterSpacing: '-0.224px', fontWeight: '400' }],
        'caption-bold': ['0.88rem', { lineHeight: '1.29', letterSpacing: '-0.224px', fontWeight: '600' }],
        'micro': ['0.75rem', { lineHeight: '1.33', letterSpacing: '-0.12px', fontWeight: '400' }],
        'micro-bold': ['0.75rem', { lineHeight: '1.33', letterSpacing: '-0.12px', fontWeight: '600' }],
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}
