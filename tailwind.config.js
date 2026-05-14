/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        accent: '#d97706',
        'accent-subtle': 'rgba(217, 119, 6, 0.12)',
        'accent-hover': 'rgba(217, 119, 6, 0.2)',
      },
      borderRadius: {
        'sm-md': '6px',
        'md-lg': '8px',
        'lg-xl': '12px',
        'xl-2xl': '16px',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Noto Sans', 'Helvetica', 'Arial', 'sans-serif'],
        mono: ['SF Mono', 'SFMono-Regular', 'ui-monospace', 'Menlo', 'Monaco', 'Cascadia Mono', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': '11px',
        '3xs': '10px',
      },
      transitionDuration: {
        '150': '150ms',
        '200': '200ms',
      },
    },
  },
  plugins: [],
};
