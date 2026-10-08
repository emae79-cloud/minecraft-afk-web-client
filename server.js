const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mineflayer = require('mineflayer');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public'));

let bot = null;
let botOptions = {
  host: 'play.mc4fun.net',
  port: 25565,
  username: 'nusretyasir',
  password: '2013',
  autoLogin: true,
  autoSkyblock: true,
  autoReconnect: true,
  cmdDelay: 3000 // Komutlar arası bekleme süresi (milisaniye)
};

let reconnectTimeout = null;

function cleanupBot() {
  if (bot) {
    try {
      bot.removeAllListeners();
      bot.end();
    } catch (e) {}
    bot = null;
  }
}

function sendStats() {
  if (bot && bot.entity) {
    const stats = {
      health: bot.health || 0,
      food: bot.food || 0,
      pos: {
        x: Math.round(bot.entity.position.x),
        y: Math.round(bot.entity.position.y),
        z: Math.round(bot.entity.position.z)
      }
    };
    io.emit('statsUpdate', stats);
  }
}

function createBot() {
  cleanupBot();

  io.emit('status', 'connecting');
  io.emit('chat', '[SİSTEM] Sunucuya bağlanılıyor...');

  bot = mineflayer.createBot({
    host: botOptions.host,
    port: botOptions.port,
    username: botOptions.username,
    version: false
  });

  // Can ve pozisyon değiştikçe arayüze güncel bilgi gönder
  bot.on('health', sendStats);
  bot.on('move', sendStats);

  bot.on('spawn', () => {
    io.emit('status', 'online');
    io.emit('chat', `[SİSTEM] Bot başarıyla ${botOptions.host} sunucusuna girdi!`);
    sendStats();

    let delay = botOptions.cmdDelay || 3000;

    // 1. Adım: İsteğe bağlı Otomatik /login
    if (botOptions.autoLogin && botOptions.password && botOptions.password.trim() !== '') {
      setTimeout(() => {
        if (bot) {
          bot.chat(`/login ${botOptions.password}`);
          io.emit('chat', '[SİSTEM] Otomatik /login gönderildi.');
        }
      }, delay);
    }

    // 2. Adım: İsteğe bağlı Otomatik /skyblock (Login'den sonraki gecikmeyle)
    if (botOptions.autoSkyblock) {
      let skyblockDelay = botOptions.autoLogin ? delay * 2 : delay;
      setTimeout(() => {
        if (bot) {
          bot.chat('/skyblock');
          io.emit('chat', '[SİSTEM] Otomatik /skyblock komutu gönderildi.');
        }
      }, skyblockDelay);
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
    cleanupBot();
    handleReconnect();
  });

  bot.on('error', (err) => {
    io.emit('status', 'offline');
    io.emit('chat', `[SİSTEM] Hata: ${err.message}`);
    cleanupBot();
    handleReconnect();
  });

  bot.on('end', () => {
    io.emit('status', 'offline');
    io.emit('chat', '[SİSTEM] Sunucu bağlantısı koptu.');
    cleanupBot();
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
  sendStats();

  socket.on('startBot', (data) => {
    botOptions.host = data.host || botOptions.host;
    botOptions.port = parseInt(data.port) || 25565;
    botOptions.username = data.username || botOptions.username;
    botOptions.password = data.password || '2013';
    botOptions.autoLogin = data.autoLogin !== undefined ? data.autoLogin : true;
    botOptions.autoSkyblock = data.autoSkyblock !== undefined ? data.autoSkyblock : true;
    botOptions.autoReconnect = data.autoReconnect !== undefined ? data.autoReconnect : true;
    botOptions.cmdDelay = parseInt(data.cmdDelay) || 3000;
    
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
      io.emit('chat', '[SİSTEM] Bot oyunda değil! Lütfen önce "Sunucuya Bağlan" butonuna basın.');
    }
  });

  socket.on('sendMessage', (msg) => {
    if (bot) {
      bot.chat(msg);
      io.emit('chat', `[SİZ]: ${msg}`);
    } else {
      io.emit('chat', '[SİSTEM] Bot oyunda değil! Lütfen önce "Sunucuya Bağlan" butonuna basın.');
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda çalışıyor`);
});