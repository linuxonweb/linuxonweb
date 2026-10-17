export function firefoxJitFlags(search) {
  const params = new URLSearchParams(search);
  const flags = [];
  for (const name of ['pblic', 'pblbc']) {
    const value = params.get(name);
    if (/^[0-9]$/.test(value ?? '')) flags.push(`${name}=${value}`);
  }
  const loop = params.get('pbljit');
  if (loop === '0' || loop === '1') flags.push(`PBLJIT=${loop}`);
  return flags;
}
