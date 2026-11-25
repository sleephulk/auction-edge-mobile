// Profile colours in one place. TPO and Volume Profile use different families
// so they never get confused when both are on: TPO is blue inside the value
// area on light grey outside it; Volume Profile is amber, with rows outside the
// value area dimmed.

export const TPO_COLORS = {
  va: '#3d6fb6',
  outside: '#a7afb9',
  poc: '#7fb0ff',
  edge: '#5a82bd',
  ib: '#c9d1d9',
  faint: '#6b7684',
};

export const VP_COLORS = {
  va: '#d08a2c',
  poc: '#ffc266',
  edge: '#b07a35',
};
