const command = process.argv[2];

if (command === 'init') {
  import('./config/init.js').then(m => m.runInit());
} else {
  import('./main.js').then(m => m.startAgent().catch(console.error));
}
