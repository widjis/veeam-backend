// send-test.js
import dgram from 'dgram';

const client = dgram.createSocket('udp4');
const message = Buffer.from("<134> Veeam Job 'Test Backup' finished with Warning at 2025-08-28 11:10");

client.send(message, 514, '127.0.0.1', (err) => {
  if (err) console.error("❌ Error:", err);
  else console.log("✅ Test event sent to localhost:514");
  client.close();
});
