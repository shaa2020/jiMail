/* Authoritative test DNS server (UDP) used by integration and e2e tests.
 * Records live in memory or in a JSON file: { "example.test|TXT": ["v=spf1 mx -all"], ... }.
 * Usage standalone: node test/support/fake-dns.js <port> <records.json>
 */
const dns2 = require('dns2');
const fs = require('node:fs');
const { Packet } = dns2;

class FakeDns {
  constructor(records = {}) {
    this.records = records;
    this.file = null;
  }
  set(name, type, values) {
    this.records[`${name.toLowerCase()}|${type}`] = values;
    this.flush();
  }
  add(name, type, value) {
    const k = `${name.toLowerCase()}|${type}`;
    (this.records[k] ??= []).push(value);
    this.flush();
  }
  clear(name, type) {
    delete this.records[`${name.toLowerCase()}|${type}`];
    this.flush();
  }
  flush() {
    if (this.file) fs.writeFileSync(this.file, JSON.stringify(this.records, null, 2));
  }
  load() {
    if (this.file && fs.existsSync(this.file)) this.records = JSON.parse(fs.readFileSync(this.file, 'utf8'));
  }
  answers(name, type) {
    this.load();
    const n = name.toLowerCase().replace(/\.$/, '');
    const vals = this.records[`${n}|${type}`] ?? [];
    const base = { name, class: Packet.CLASS.IN, ttl: 5 };
    return vals.map((v) => {
      switch (type) {
        case 'TXT': {
          const chunks = [];
          for (let i = 0; i < v.length; i += 255) chunks.push(v.slice(i, i + 255));
          return { ...base, type: Packet.TYPE.TXT, data: chunks.length ? chunks : [''] };
        }
        case 'MX':
          return { ...base, type: Packet.TYPE.MX, exchange: v.exchange, priority: v.priority };
        case 'CNAME':
          return { ...base, type: Packet.TYPE.CNAME, domain: v };
        case 'PTR':
          return { ...base, type: Packet.TYPE.PTR, domain: v };
        case 'A':
          return { ...base, type: Packet.TYPE.A, address: v };
        default:
          return null;
      }
    }).filter(Boolean);
  }
  nameExists(name) {
    const n = name.toLowerCase().replace(/\.$/, '');
    return Object.keys(this.records).some((k) => k.startsWith(`${n}|`));
  }
  listen(port) {
    this.server = dns2.createServer({
      udp: true,
      handle: (request, send) => {
        const response = Packet.createResponseFromRequest(request);
        const [q] = request.questions;
        if (!q) return send(response);
        const type = Packet.typeName(q.type);
        response.header.aa = 1;
        response.answers.push(...this.answers(q.name, type));
        if (!response.answers.length && !this.nameExists(q.name)) response.header.rcode = Packet.RCODE.NXDOMAIN ?? 3;
        send(response);
      },
    });
    return this.server.listen({ udp: { port, address: '127.0.0.1', type: 'udp4' } });
  }
  async close() {
    if (this.server) await this.server.close();
  }
}

module.exports = { FakeDns };

if (require.main === module) {
  const port = Number(process.argv[2] ?? 5353);
  const file = process.argv[3];
  const d = new FakeDns();
  if (file) {
    d.file = file;
    if (!fs.existsSync(file)) fs.writeFileSync(file, '{}');
    d.load();
  }
  d.listen(port).then(() => console.log(`fake DNS on 127.0.0.1:${port}${file ? ` (records: ${file})` : ''}`));
}
