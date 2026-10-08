const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mineflayer = require('mineflayer');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Public klasörünü web için dışa aktar
app.use(express.static('public'));

let bot = null;
let botOptions = {
  host: 'play.mc4fun.net',
  port: 25565,
  username: 'nusretyasir',
  password: '2013',              
  autoSkyblock: true,
  autoReconnect: true
};

let reconnectTimeout = null;

function createBot() {
  if (bot) {
    try { bot.end(); } catch (e) {}
  }

  io.emit('status', 'connecting');
  io.emit('chat', '[SİSTEM] Sunucuya bağlanılıyor...');

  bot = mineflayer.createBot({
    host: botOptions.host,
    port: botOptions.port,
    username: botOptions.username,
    version: false
  });

  bot.on('spawn', () => {
    io.emit('status', 'online');
    io.emit('chat', `[SİSTEM] Bot başarıyla ${botOptions.host} sunucusuna girdi!`);

    // Otomatik /login
    if (botOptions.password && botOptions.password.trim() !== '') {
      setTimeout(() => {
        bot.chat(`/login ${botOptions.password}`);
        io.emit('chat', '[SİSTEM] Otomatik /login gönderildi.');
      }, 2000);
    }

    // Otomatik /skyblock
    if (botOptions.autoSkyblock) {
      setTimeout(() => {
        bot.chat('/skyblock');
        io.emit('chat', '[SİSTEM] Otomatik /skyblock komutu gönderildi.');
      }, 4500);
    }
  });

  bot.on('chat', (username, message) => {
    io.emit('chat', `${username}: ${message}`);
  });

  bot.on('messagestr', (message) => {
    if (message.trim()) {
      io.emit('chat', message);
    }
  });

  bot.on('kicked', (reason) => {
    const reasonText = typeof reason === 'object' ? JSON.stringify(reason) : reason;
    io.emit('status', 'offline');
    io.emit('chat', `[SİSTEM] Sunucudan atıldı: ${reasonText}`);
    handleReconnect();
  });

  bot.on('error', (err) => {
    io.emit('status', 'offline');
    io.emit('chat', `[SİSTEM] Hata: ${err.message}`);
    handleReconnect();
  });

  bot.on('end', () => {
    io.emit('status', 'offline');
    io.emit('chat', '[SİSTEM] Sunucu bağlantısı koptu.');
    handleReconnect();
  });
}

function handleReconnect() {
  if (botOptions.autoReconnect) {
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    io.emit('chat', '[SİSTEM] 10 saniye içinde otomatik tekrar bağlanılacak...');
    reconnectTimeout = setTimeout(() => {
      createBot();
    }, 10000);
  }
}

io.on('connection', (socket) => {
  socket.emit('status', (bot && bot.entity) ? 'online' : 'offline');

  socket.on('startBot', (data) => {
    botOptions.host = data.host || botOptions.host;
    botOptions.port = parseInt(data.port) || 25565;
    botOptions.username = data.username || botOptions.username;
    botOptions.password = data.password || '2013';
    botOptions.autoSkyblock = data.autoSkyblock !== undefined ? data.autoSkyblock : true;
    botOptions.autoReconnect = data.autoReconnect !== undefined ? data.autoReconnect : true;
    
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    createBot();
  });

  socket.on('reconnectBot', () => {
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    createBot();
  });

  socket.on('sendCmd', (cmd) => {
    if (bot) {
      bot.chat(cmd);
      io.emit('chat', `[SİZ]: ${cmd}`);
    } else {
      io.emit('chat', '[SİSTEM] Bot henüz oyunda değil!');
    }
  });

  socket.on('sendMessage', (msg) => {
    if (bot) {
      bot.chat(msg);
      io.emit('chat', `[SİZ]: ${msg}`);
    } else {
      io.emit('chat', '[SİSTEM] Bot henüz oyunda değil!');
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda çalışıyor`);
});