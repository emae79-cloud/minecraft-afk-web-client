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
  password: '',
  autoSkyblock: false,
  autoReconnect: true,
  cmdDelay: 3000
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
  io.emit('chat', `[SİSTEM] ${botOptions.username} adıyla sunucuya bağlanılıyor...`);

  bot = mineflayer.createBot({
    host: botOptions.host,
    port: botOptions.port,
    username: botOptions.username,
    version: false
  });

  bot.on('health', sendStats);
  bot.on('move', sendStats);

  bot.on('spawn', () => {
    io.emit('status', 'online');
    io.emit('chat', `[SİSTEM] Bot (${botOptions.username}) başarıyla ${botOptions.host} sunucusuna girdi!`);
    sendStats();

    if (botOptions.autoSkyblock) {
      setTimeout(() => {
        if (bot) {
          bot.chat('/skyblock');
          io.emit('chat', '[SİZ]: /skyblock');
        }
      }, botOptions.cmdDelay || 3000);
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
    botOptions.host = data.host || 'play.mc4fun.net';
    botOptions.port = parseInt(data.port) || 25565;
    botOptions.username = data.username && data.username.trim() !== '' ? data.username.trim() : 'nusretyasir';
    botOptions.password = data.password || '';
    botOptions.autoSkyblock = data.autoSkyblock !== undefined ? data.autoSkyblock : false;
    botOptions.autoReconnect = data.autoReconnect !== undefined ? data.autoReconnect : true;
    botOptions.cmdDelay = parseInt(data.cmdDelay) || 3000;
    
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    createBot();
  });

  socket.on('reconnectBot', () => {
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    createBot();
  });

  socket.on('sendLogin', (pwd) => {
    const passToSend = pwd || botOptions.password;
    if (bot) {
      if (passToSend && passToSend.trim() !== '') {
        bot.chat(`/login ${passToSend}`);
        io.emit('chat', '[SİZ]: /login ********');
      } else {
        io.emit('chat', '[SİSTEM] Şifre alanı boş! Lütfen şifre girin.');
      }
    } else {
      io.emit('chat', '[SİSTEM] Bot oyunda değil!');
    }
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