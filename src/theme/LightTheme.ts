import type { ThemeTypes } from '@/types/themeTypes/ThemeType';

const PurpleTheme: ThemeTypes = {
  name: 'PurpleTheme',
  dark: false,
  variables: {
    'border-color': '#d7deea',
    'carousel-control-size': 10
  },
  colors: {
    primary: '#243f92',
    secondary: '#4f6fc2',
    info: '#2aa7ff',
    success: '#1fa971',
    accent: '#1f5bb5',
    warning: '#ffb02e',
    error: '#e53935',
    lightprimary: '#e8eefc',
    lightsecondary: '#edf3ff',
    lightsuccess: '#d7f6ea',
    lighterror: '#fbe0df',
    lightwarning: '#fff3da',
    darkText: '#14223d',
    lightText: '#90a0bf',
    darkprimary: '#1d3277',
    darksecondary: '#3a58aa',
    borderLight: '#d8dfec',
    inputBorder: '#6f7d98',
    containerBg: '#edf1f7',
    surface: '#fff',
    'on-surface-variant': '#fff',
    facebook: '#4267b2',
    twitter: '#1da1f2',
    linkedin: '#0e76a8',
    gray100: '#f3f6fb',
    primary200: '#94adf4',
    secondary200: '#a9bced'
  }
};

export { PurpleTheme };
