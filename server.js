const RESERVED_ROOM_NAMES = new Set([
  'api', 'admin', 'health', 'socket.io', 'socketio', 'favicon.ico', 'robots.txt',
  'manifest.json', 'index.html', 'room.html', '404.html', 'admin-stats.html', 'health.txt',
  'client.js', 'client.css', 'landing.js', 'adapter.js', 'fonts.css', 'profile-transfer.html',
  'fonts', 'images', 'audio', 'media',
]);

function isReservedRoomName(room) {
  if (!room) return true;
  const cleaned = room.replace(/^\/+/, '').toLowerCase();
  if (!cleaned) return true;
  if (RESERVED_ROOM_NAMES.has(cleaned)) return true;
  if (cleaned.startsWith('api')) return true;
  if (cleaned.startsWith('admin')) return true;
  if (cleaned.startsWith('health')) return true;
  if (cleaned.startsWith('socket.io')) return true;
  const lastSegment = cleaned.split('/').filter(Boolean).pop() || '';
  return /\.[a-z0-9]{1,8}$/i.test(lastSegment);
}

app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.get('/health', (req, res) => res.json({ status: 'ok', uptime: Math.floor(process.uptime()) }));

app.get('/api*', (req, res) => notFound(res, 404));
app.get('/admin*', (req, res) => notFound(res, 404));

app.get('/:room', (req, res) => {
  const room = decodeURIComponent(req.params.room || '').trim();
  if (!room) return notFound(res, 404);
  if (room.includes('/')) return notFound(res, 404);
  if (isReservedRoomName(room)) return notFound(res, 404);
  res.sendFile(path.join(PUBLIC_DIR, 'room.html'));
});

app.use((req, res) => notFound(res, 404));