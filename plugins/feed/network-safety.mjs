import net from 'node:net';

export function privateIp(address) {
  if (net.isIPv4(address)) {
    const [a, b, c] = address.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && ((b === 0 && c === 0) || (b === 0 && c === 2) || b === 168))
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      || a === 203 && b === 0 && c === 113 || a >= 224;
  }
  const value = address.toLowerCase();
  if (value.startsWith('::ffff:')) {
    const mapped = value.slice(7);
    return net.isIPv4(mapped) ? privateIp(mapped) : true;
  }
  return !/^[23][0-9a-f]{0,3}:/.test(value) || value.startsWith('2001:db8:')
    || value.startsWith('2001:10:') || value.startsWith('2001:2:');
}
