// Transform only the isolated QA server copy; never the user's running service.
export function fixtureProxyOverlay(source, endpoints) {
  if (endpoints.proxyAddress !== '192.0.2.10' || endpoints.proxyHost !== '127.0.0.1' ||
      !Array.isArray(endpoints.ports) || endpoints.ports.length !== 5 ||
      !endpoints.ports.every(p => Number.isInteger(p) && p > 0 && p < 65536) ||
      new Set(endpoints.ports).size !== endpoints.ports.length) throw Error('fixture proxy contract differs');
  if (JSON.stringify(Object.keys(endpoints.urls).sort()) !== JSON.stringify(['badchain','expired','untrusted','valid','wronghost'])) throw Error('fixture case set differs');
  for (const url of Object.values(endpoints.urls)) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'nightly-nss-fixture.test' || !endpoints.ports.includes(Number(parsed.port))) throw Error('fixture URL differs');
  }
  const dns = 'const addresses = await dns.resolve4(name);';
  const tcp = 'const remote = net.connect({ host, port: targetPort });';
  for (const anchor of [dns, tcp]) if (source.split(anchor).length !== 2) throw Error('QA proxy anchor differs');
  source = source.replace(dns, "const addresses = name === 'nightly-nss-fixture.test' ? ['192.0.2.10'] : await dns.resolve4(name);");
  return source.replace(tcp, `const remote = net.connect({ host: host === '192.0.2.10' && ${JSON.stringify(endpoints.ports)}.includes(targetPort) ? '127.0.0.1' : host, port: targetPort });`);
}
