const express = require('express');
const { createBot } = require('mineflayer');
const { SocksProxyAgent } = require('socks-proxy-agent');
const app = express();

app.use(express.json());
app.use(express.static('public')); // Arayüz için

const SERVER_IP = "oyun.sunucusadresi.com";
const SERVER_PORT = 25565;

// Kullanılacak 2 adet proxy adresi (Burayı kendi proxy'lerinle değiştirebilirsin)
const proxyList = [
  "IP_ADRESI_1:PORT",
  "IP_ADRESI_2:PORT"
];

const startupCommands = [
  "/login sifreniz123",
  "/anarşi",
  "/warp arsa"
];

const spamMessage = "Bu otomatik bir AFK spam mesajıdır!";
const spamIntervalMs = 15000;

// Botları Başlatma Endpoint'i
app.get('/api/start-bots', (req, res) => {
  try {
    for (let i = 1; i <= 15; i++) {
      const botConfig = {
        username: `BotKullanici${i}`,
        proxy: proxyList[(i - 1) % proxyList.length]
      };

      setTimeout(() => {
        createBotInstance(botConfig);
      }, (i - 1) * 3000);
    }
    res.json({ success: true, message: "15 Bot başlatma komutu gönderildi!" });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

function createBotInstance(config) {
  const options = {
    host: SERVER_IP,
    port: SERVER_PORT,
    username: config.username,
    version: false
  };

  if (config.proxy && !config.proxy.includes("IP_ADRESI")) {
    options.agent = new SocksProxyAgent(`socks://${config.proxy}`);
  }

  const bot = createBot(options);

  bot.on('spawn', () => {
    console.log(`${config.username} oyuna giriş yaptı!`);

    startupCommands.forEach((cmd, cmdIndex) => {
      setTimeout(() => {
        bot.chat(cmd);
      }, (cmdIndex + 1) * 2000);
    });

    setInterval(() => {
      bot.chat(spamMessage);
    }, spamIntervalMs);
  });
}

app.listen(3000, () => {
  console.log("Uygulama sunucusu aktif: http://localhost:3000");
});