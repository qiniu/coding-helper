const fs = require('node:fs');
if (process.stdin.isTTY) {
  const fd = fs.openSync('/dev/tty', 'r');
  fs.closeSync(fd);
  process.stdout.write('CONTROL_TTY_OK\n');
}
let count = 0;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    count++;
    if (count === 1) setTimeout(() => {
      fs.writeFileSync(process.env.SIGNAL_COUNT, String(count));
      process.exit(0);
    }, 100);
  });
}
fs.writeFileSync(process.env.SIGNAL_READY, 'ready');
process.stdin.resume();
process.stdin.on('data', () => process.stdout.write('INPUT_OK\n'));
setInterval(() => {}, 1000);
