const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mineflayer = require('mineflayer');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public'));

// Çoklu botları tutacağımız obje
const bots = new Map();

function initBotData(username) {
  if (!bots.has(username)) {
    bots.set(username, {
      instance: null,
      options: {},
      reconnectTimeout: null,
      status: 'offline',
      chatHistory: [] // Sohbet geçmişini kaydetmek için
    });
  }
  return bots.get(username);
}

function saveAndEmitChat(username, msg, type = 'chat') {
  const botData = initBotData(username);
  const chatMsg = { text: msg, type: type, time: new Date().toLocaleTimeString() };
  botData.chatHistory.push(chatMsg);
  if (botData.chatHistory.length > 100) botData.chatHistory.shift(); // Son 100 mesajı tut
  io.emit('chat', { username, ...chatMsg });
}

function cleanupBot(username) {
  const botData = bots.get(username);
  if (botData && botData.instance) {
    try {
      botData.instance.removeAllListeners();
      botData.instance.end();
    } catch (e) {}
    botData.instance = null;
  }
}

function sendStats(username) {
  const botData = bots.get(username);
  if (botData && botData.instance && botData.instance.entity) {
    const stats = {
      username: username,
      health: botData.instance.health || 0,
      food: botData.instance.food || 0,
      pos: {
        x: Math.round(botData.instance.entity.position.x),
        y: Math.round(botData.instance.entity.position.y),
        z: Math.round(botData.instance.entity.position.z)
      }
    };
    io.emit('statsUpdate', stats);
  }
}

function createBot(username) {
  const botData = initBotData(username);
  cleanupBot(username);

  botData.status = 'connecting';
  io.emit('status', { username, status: 'connecting' });
  saveAndEmitChat(username, `[SİSTEM] ${username} adıyla bağlanılıyor...`, 'system');

  const bot = mineflayer.createBot({
    host: botData.options.host,
    port: botData.options.port,
    username: username,
    version: false
  });

  botData.instance = bot;

  bot.on('health', () => sendStats(username));
  bot.on('move', () => sendStats(username));

  bot.on('spawn', () => {
    botData.status = 'online';
    io.emit('status', { username, status: 'online' });
    saveAndEmitChat(username, `[SİSTEM] Başarıyla giriş yapıldı!`, 'system');
    sendStats(username);

    if (botData.options.autoSkyblock) {
      setTimeout(() => {
        if (botData.instance) {
          botData.instance.chat('/skyblock');
          saveAndEmitChat(username, `[SİZ]: /skyblock`, 'self');
        }
      }, botData.options.cmdDelay || 3000);
    }
  });

  bot.on('chat', (user, message) => {
    saveAndEmitChat(username, `${user}: ${message}`, 'chat');
  });

  bot.on('messagestr', (message) => {
    if (message.trim()) {
      saveAndEmitChat(username, message, 'chat');
    }
  });

  bot.on('kicked', (reason) => {
    const reasonText = typeof reason === 'object' ? JSON.stringify(reason) : reason;
    botData.status = 'offline';
    io.emit('status', { username, status: 'offline' });
    saveAndEmitChat(username, `[SİSTEM] Atıldı: ${reasonText}`, 'system');
    cleanupBot(username);
    handleReconnect(username);
  });

  bot.on('error', (err) => {
    botData.status = 'offline';
    io.emit('status', { username, status: 'offline' });
    saveAndEmitChat(username, `[SİSTEM] Hata: ${err.message}`, 'system');
    cleanupBot(username);
    handleReconnect(username);
  });

  bot.on('end', () => {
    botData.status = 'offline';
    io.emit('status', { username, status: 'offline' });
    saveAndEmitChat(username, `[SİSTEM] Bağlantı koptu.`, 'system');
    cleanupBot(username);
    handleReconnect(username);
  });
}

function handleReconnect(username) {
  const botData = bots.get(username);
  if (botData && botData.options.autoReconnect) {
    if (botData.reconnectTimeout) clearTimeout(botData.reconnectTimeout);
    saveAndEmitChat(username, `[SİSTEM] 10 saniye içinde tekrar bağlanılacak...`, 'system');
    botData.reconnectTimeout = setTimeout(() => {
      createBot(username);
    }, 10000);
  }
}

io.on('connection', (socket) => {
  // Yeni biri bağlandığında mevcut botların durumunu ve geçmişini gönder
  bots.forEach((botData, username) => {
    socket.emit('status', { username, status: botData.status });
    socket.emit('chatHistory', { username, history: botData.chatHistory });
    sendStats(username);
  });

  socket.on('startBot', (data) => {
    const username = data.username.trim();
    if (!username) return;
    const botData = initBotData(username);
    botData.options = data;
    
    if (botData.reconnectTimeout) clearTimeout(botData.reconnectTimeout);
    createBot(username);
  });

  socket.on('stopBot', (username) => {
    const botData = bots.get(username);
    if (botData) {
      botData.options.autoReconnect = false;
      if (botData.reconnectTimeout) clearTimeout(botData.reconnectTimeout);
      cleanupBot(username);
      botData.status = 'offline';
      io.emit('status', { username, status: 'offline' });
      saveAndEmitChat(username, `[SİSTEM] Bot manuel olarak durduruldu.`, 'system');
    }
  });

  socket.on('sendLogin', (data) => {
    const botData = bots.get(data.username);
    if (botData && botData.instance) {
      if (data.password) {
        botData.instance.chat(`/login ${data.password}`);
        saveAndEmitChat(data.username, `[SİZ]: /login ********`, 'self');
      }
    }
  });

  socket.on('sendMessage', (data) => {
    const botData = bots.get(data.username);
    if (botData && botData.instance) {
      botData.instance.chat(data.message);
      saveAndEmitChat(data.username, `[SİZ]: ${data.message}`, 'self');
    }
  });
});

// Render için Uyanık Tutma Pingi
setInterval(() => {
  if (process.env.RENDER_EXTERNAL_URL) {
    http.get(process.env.RENDER_EXTERNAL_URL, () => {}).on('error', () => {});
  }
}, 5 * 60 * 1000); // 5 dakikaya düşürüldü

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Sunucu ${PORT} portunda çalışıyor`));