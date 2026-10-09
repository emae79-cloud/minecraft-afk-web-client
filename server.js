const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mineflayer = require('mineflayer');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

app.use(express.static('public'));

// Aktif tüm botları tutacağımız Map (username -> botData)
const bots = new Map();

function getOrCreateBotData(username) {
  if (!bots.has(username)) {
    bots.set(username, {
      instance: null,
      options: {},
      reconnectTimeout: null,
      status: 'offline',
      chatHistory: [],
      currentWindow: null
    });
  }
  return bots.get(username);
}

function emitToAll(event, payload) {
  io.emit(event, payload);
}

function addChat(username, text, type = 'chat') {
  const bData = getOrCreateBotData(username);
  const msgObj = {
    username,
    text,
    type, // 'chat', 'system', 'self'
    time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  };
  bData.chatHistory.push(msgObj);
  if (bData.chatHistory.length > 200) bData.chatHistory.shift(); // Son 200 mesajı tut
  emitToAll('chatMessage', msgObj);
}

function cleanupBot(username) {
  const bData = bots.get(username);
  if (bData && bData.instance) {
    try {
      bData.instance.removeAllListeners();
      bData.instance.end();
    } catch (e) {}
    bData.instance = null;
    bData.currentWindow = null;
  }
}

function sendStats(username) {
  const bData = bots.get(username);
  if (bData && bData.instance && bData.instance.entity) {
    const stats = {
      username,
      health: bData.instance.health || 0,
      food: bData.instance.food || 0,
      pos: {
        x: Math.round(bData.instance.entity.position.x),
        y: Math.round(bData.instance.entity.position.y),
        z: Math.round(bData.instance.entity.position.z)
      }
    };
    emitToAll('statsUpdate', stats);
  }
}

function sendWindowData(username, window) {
  if (!window) return;
  const slots = window.slots.map((item, index) => {
    if (!item) return { slot: index, empty: true };
    let lore = [];
    try {
      if (item.nbt && item.nbt.value && item.nbt.value.display && item.nbt.value.display.value.Lore) {
        lore = item.nbt.value.display.value.Lore.value.value;
      }
    } catch (e) {}

    return {
      slot: index,
      name: item.name,
      count: item.count,
      displayName: item.displayName || item.name,
      lore: lore
    };
  });

  let titleText = 'Menü / Sandık';
  try {
    if (window.title) {
      const parsed = typeof window.title === 'string' ? JSON.parse(window.title) : window.title;
      titleText = parsed.text || parsed.translate || 'Menü';
    }
  } catch (e) {
    titleText = 'Menü';
  }

  emitToAll('openWindow', {
    username,
    title: titleText,
    slots: slots
  });
}

function createBot(username) {
  const bData = getOrCreateBotData(username);
  cleanupBot(username);

  bData.status = 'connecting';
  emitToAll('statusUpdate', { username, status: 'connecting' });
  addChat(username, `[SİSTEM] ${username} sunucuya bağlanıyor...`, 'system');

  try {
    const bot = mineflayer.createBot({
      host: bData.options.host || 'play.mc4fun.net',
      port: parseInt(bData.options.port) || 25565,
      username: username,
      version: false
    });

    bData.instance = bot;

    bot.on('health', () => sendStats(username));
    bot.on('move', () => sendStats(username));

    bot.on('spawn', () => {
      bData.status = 'online';
      emitToAll('statusUpdate', { username, status: 'online' });
      addChat(username, `[SİSTEM] Bot (${username}) başarıyla bağlandı!`, 'system');
      sendStats(username);

      if (bData.options.autoSkyblock) {
        setTimeout(() => {
          if (bData.instance) {
            bData.instance.chat('/skyblock');
            addChat(username, '[SİZ]: /skyblock', 'self');
          }
        }, parseInt(bData.options.cmdDelay) || 3000);
      }
    });

    // Menü / Sandık (GUI) açıldığında
    bot.on('windowOpen', (window) => {
      bData.currentWindow = window;
      sendWindowData(username, window);
      window.on('updateSlot', () => sendWindowData(username, window));
      window.on('close', () => {
        bData.currentWindow = null;
        emitToAll('closeWindow', { username });
      });
    });

    bot.on('chat', (user, message) => {
      addChat(username, `${user}: ${message}`, 'chat');
    });

    bot.on('messagestr', (message) => {
      if (message.trim()) {
        addChat(username, message, 'chat');
      }
    });

    bot.on('kicked', (reason) => {
      const reasonText = typeof reason === 'object' ? JSON.stringify(reason) : reason;
      bData.status = 'offline';
      emitToAll('statusUpdate', { username, status: 'offline' });
      addChat(username, `[SİSTEM] Sunucudan atıldı: ${reasonText}`, 'system');
      cleanupBot(username);
      handleReconnect(username);
    });

    bot.on('error', (err) => {
      bData.status = 'offline';
      emitToAll('statusUpdate', { username, status: 'offline' });
      addChat(username, `[SİSTEM] Hata: ${err.message}`, 'system');
      cleanupBot(username);
      handleReconnect(username);
    });

    bot.on('end', () => {
      bData.status = 'offline';
      emitToAll('statusUpdate', { username, status: 'offline' });
      addChat(username, '[SİSTEM] Bağlantı koptu.', 'system');
      cleanupBot(username);
      handleReconnect(username);
    });

  } catch (err) {
    bData.status = 'offline';
    emitToAll('statusUpdate', { username, status: 'offline' });
    addChat(username, `[SİSTEM] Başlatma Hatası: ${err.message}`, 'system');
  }
}

function handleReconnect(username) {
  const bData = bots.get(username);
  if (bData && bData.options.autoReconnect) {
    if (bData.reconnectTimeout) clearTimeout(bData.reconnectTimeout);
    addChat(username, '[SİSTEM] 10 saniye içinde otomatik tekrar bağlanılacak...', 'system');
    bData.reconnectTimeout = setTimeout(() => {
      createBot(username);
    }, 10000);
  }
}

io.on('connection', (socket) => {
  // Bağlanan istemciye tüm aktif botların durumunu ve sohbet geçmişini yolla
  const botList = [];
  bots.forEach((bData, uname) => {
    botList.push({
      username: uname,
      status: bData.status,
      options: bData.options,
      chatHistory: bData.chatHistory
    });
  });
  socket.emit('initData', botList);

  socket.on('startBot', (data) => {
    const username = data.username ? data.username.trim() : '';
    if (!username) return;

    const bData = getOrCreateBotData(username);
    bData.options = {
      host: data.host || 'play.mc4fun.net',
      port: data.port || 25565,
      password: data.password || '',
      autoSkyblock: !!data.autoSkyblock,
      autoReconnect: data.autoReconnect !== false,
      cmdDelay: data.cmdDelay || 3000
    };

    if (bData.reconnectTimeout) clearTimeout(bData.reconnectTimeout);
    createBot(username);
  });

  socket.on('stopBot', (username) => {
    const bData = bots.get(username);
    if (bData) {
      bData.options.autoReconnect = false;
      if (bData.reconnectTimeout) clearTimeout(bData.reconnectTimeout);
      cleanupBot(username);
      bData.status = 'offline';
      emitToAll('statusUpdate', { username, status: 'offline' });
      addChat(username, '[SİSTEM] Bot manuel olarak durduruldu.', 'system');
    }
  });

  socket.on('sendLogin', (data) => {
    const { username, password } = data;
    const bData = bots.get(username);
    if (bData && bData.instance) {
      if (password) {
        bData.instance.chat(`/login ${password}`);
        addChat(username, '[SİZ]: /login ********', 'self');
      } else {
        addChat(username, '[SİSTEM] Şifre alanı boş!', 'system');
      }
    }
  });

  socket.on('sendMessage', (data) => {
    const { username, message } = data;
    const bData = bots.get(username);
    if (bData && bData.instance) {
      bData.instance.chat(message);
      addChat(username, `[SİZ]: ${message}`, 'self');
    } else {
      addChat(username, '[SİSTEM] Bot oyunda değil!', 'system');
    }
  });

  socket.on('clickSlot', (data) => {
    const { username, slotIndex } = data;
    const bData = bots.get(username);
    if (bData && bData.instance && bData.currentWindow) {
      try {
        bData.instance.clickWindow(slotIndex, 0, 0);
      } catch (e) {
        console.log('Slot tıklama hatası:', e.message);
      }
    }
  });

  socket.on('closeCurrentWindow', (username) => {
    const bData = bots.get(username);
    if (bData && bData.instance && bData.currentWindow) {
      try {
        bData.instance.closeWindow(bData.currentWindow);
        bData.currentWindow = null;
      } catch (e) {}
    }
  });
});

// Render Uyanık Tutma (Self-Ping) - Her 4 dakikada bir isteği yeniler
setInterval(() => {
  const renderUrl = process.env.RENDER_EXTERNAL_URL;
  if (renderUrl) {
    http.get(renderUrl, () => {}).on('error', () => {});
  }
}, 4 * 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda başarıyla başlatıldı.`);
});
