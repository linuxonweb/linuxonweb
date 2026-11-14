export function firefoxJitFlags(search) {
  const params = new URLSearchParams(search);
  const flags = [];
  for (const name of ['pblic', 'pblbc']) {
    const value = params.get(name);
    if (/^[0-9]$/.test(value ?? '')) flags.push(`${name}=${value}`);
  }
  const loop = params.get('pbljit');
  if (loop === '0' || loop === '1') flags.push(`PBLJIT=${loop}`);
  // Direct compiled-to-compiled calls in the method tier (default off in the image).
  const direct = params.get('pblbc_direct');
  if (direct === '0' || direct === '1') flags.push(`PBLBC_DIRECT=${direct}`);
  // Method-tier compile threshold: 1 to 6 digits, greater than zero.
  const hits = params.get('pblbc_hits');
  if (/^[0-9]{1,6}$/.test(hits ?? '') && Number(hits) > 0) flags.push(`PBLBC_HITS=${hits}`);
  return flags;
}
