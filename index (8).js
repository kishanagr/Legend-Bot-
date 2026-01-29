const express = require('express');
const bodyParser = require('body-parser');
const login = require('ws3-fca');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// === GLOBAL STATE ===
let botAPI = null;
let adminID = null;
let prefix = '/';
let botNickname = 'TAKLA KING';
let ownerName = 'WALEED LEGEND™';

let lockedGroups = {};
let lockedNicknames = {};
let lockedGroupPhoto = {};
let fightSessions = {};
let targetSessions = {};
let spamProtection = {};
let joinedGroups = new Set();
let currentCookies = null;
let reconnectAttempt = 0;

const signature = `\n\n✦✦✦✦✦✦✦✦✦✦✦✦✦✦✦\n      🔥 WALEED LEGEND ™ 🔥\n      👑 OWNER OF THIS BOT 👑\n✦✦✦✦✦✦✦✦✦✦✦✦✦✦✦`;
const separator = `\n═════✦ 𝕯𝖆𝖗𝖎𝖓𝖉𝖆 𝕸𝖔𝖉𝖊 ✦═════`;

// === UTILITY FUNCTIONS ===
function emitLog(message, isError = false) {
  const logMessage = `[${new Date().toISOString()}] ${isError ? '❌' : '✅'} ${message}`;
  console.log(logMessage);
  io.emit('botlog', logMessage);
}

function saveCookies() {
  if (!botAPI) return;
  try {
    const newAppState = botAPI.getAppState();
    const configToSave = {
      botNickname,
      ownerName,
      cookies: newAppState
    };
    fs.writeFileSync('config.json', JSON.stringify(configToSave, null, 2));
    currentCookies = newAppState;
    emitLog('✅ Cookies + Config Saved');
  } catch (e) { emitLog('❌ Save Failed: ' + e.message, true); }
}

// === BOT LOGIN & RECONNECT ===
function initializeBot(cookies) {
  emitLog('🚀 Starting WALEED LEGEND Bot...');
  currentCookies = cookies;
  reconnectAttempt = 0;

  login({ appState: currentCookies }, (err, api) => {
    if (err) {
      emitLog(`Login Failed: ${err.error || err}. Retry in 15s`, true);
      setTimeout(() => initializeBot(currentCookies), 15000);
      return;
    }

    emitLog('🟢 WALEED LEGEND BOT ONLINE');
    botAPI = api;
    api.setOptions({
      selfListen: true,
      listenEvents: true,
      updatePresence: true,
      autoMarkDelivery: false,
      autoMarkRead: false
    });

    updateJoinedGroups(api);
    setTimeout(() => {
      setBotNickEverywhere();
      sendLegendEntry();
      startListening(api);
    }, 8000);

    setInterval(saveCookies, 8 * 60 * 1000); // Save every 8 min
    setInterval(() => api.changeNickname(botNickname, null, api.getCurrentUserID()), 30 * 60 * 1000); // Refresh nick
  });
}

function startListening(api) {
  api.listenMqtt(async (err, event) => {
    if (err) {
      emitLog(`Listener Dead: ${err.message}`, true);
      setTimeout(() => initializeBot(currentCookies), 10000);
      return;
    }

    try {
      switch (event.type) {
        case 'message':
        case 'message_reply':
          await handleMessage(api, event);
          break;
        case 'event':
          if (event.logMessageType === 'log:thread-name') await handleNameChange(api, event);
          if (event.logMessageType === 'log:user-nickname') await handleNickChange(api, event);
          if (event.logMessageType === 'log:thread-image') await handlePhotoChange(api, event);
          if (event.logMessageType === 'log:subscribe') await handleBotAdded(api, event);
          break;
      }
    } catch (e) {
      emitLog(`Handler Crash: ${e.message}`, true);
    }
  });
}

// === NEW FEATURES ===
async function setBotNickEverywhere() {
  if (!botAPI) return;
  const botID = botAPI.getCurrentUserID();
  const threads = await botAPI.getThreadList(200, null, ['GROUP']);
  for (let t of threads) {
    try {
      await botAPI.changeNickname(botNickname, t.threadID, botID);
      await new Promise(r => setTimeout(r, 800));
    } catch {}
  }
}

async function sendLegendEntry() {
  const msg = `😈🔥 𝐖𝐀𝐋𝐄𝐄𝐃 𝐋𝐄𝐆𝐄𝐍𝐃 𝐊𝐀 𝐃𝐀𝐑𝐈𝐍𝐃𝐀 𝐁𝐎𝐓 𝐎𝐍𝐋𝐈𝐍𝐄 𝐇𝐎 𝐆𝐀𝐘𝐀 🔥😈\n\n𝐒𝐀𝐁 𝐇𝐀𝐓𝐄𝐑 𝐊𝐈 𝐌𝐀𝐀 𝐁𝐇𝐄𝐍 𝐄𝐊 𝐒𝐀𝐀𝐓𝐇 𝐂𝐇𝐎𝐃𝐍𝐄 𝐀𝐀 𝐆𝐀𝐘𝐀 𝐇𝐔 🔥\n\n𝐎𝐖𝐍𝐄𝐑: WALEED LEGEND™`;
  const threads = await botAPI.getThreadList(200, null, ['GROUP']);
  for (let t of threads) {
    botAPI.sendMessage(msg, t.threadID).catch(() => {});
    await new Promise(r => setTimeout(r, 1000));
  }
}

async function updateJoinedGroups(api) {
  const threads = await api.getThreadList(200, null, ['GROUP']);
  joinedGroups = new Set(threads.map(t => t.threadID));
  io.emit('groupsUpdate', Array.from(joinedGroups));
}

// === MESSAGE FORMATTING ===
async function formatLegendMessage(api, event, text) {
  let name = "User";
  try {
    const info = await api.getUserInfo(event.senderID);
    name = info[event.senderID]?.name || "User";
  } catch {}

  const mention = {
    tag: name,
    id: event.senderID,
    fromIndex: 20
  };

  return {
    body: `             🦅✨ ${name} ✨🦅\n\n${text}${signature}${separator}`,
    mentions: [mention]
  };
}

// === MAIN MESSAGE HANDLER ===
async function handleMessage(api, event) {
  const { threadID, senderID, body, mentions } = event;
  if (!body) return;

  const isAdmin = senderID === adminID;
  const lower = body.toLowerCase();

  // Anti-Spam
  if (!isAdmin) {
    if (!spamProtection[senderID]) spamProtection[senderID] = { count: 0, time: Date.now() };
    if (Date.now() - spamProtection[senderID].time < 3000) {
      spamProtection[senderID].count++;
      if (spamProtection[senderID].count > 6) {
        api.removeUserFromGroup(senderID, threadID);
        api.sendMessage("🖕 Spam karega madarchod? Nikal bahar!", threadID);
        return;
      }
    } else {
      spamProtection[senderID] = { count: 1, time: Date.now() };
    }
  }

  // Admin Mention Protection
  if (mentions && Object.keys(mentions).includes(adminID)) {
    const abuses = [
      "Oye WALEED LEGEND ko tag karega saale? Teri maa chod dunga!",
      "Boss ko disturb karega? Teri behan ki chut mein bomb daal dunga!",
      "WALEED LEGEND mera baap hai, unko tag karega to tujhe zinda jala dunga!"
    ];
    const msg = await formatLegendMessage(api, event, abuses[Math.floor(Math.random() * abuses.length)]);
    return api.sendMessage(msg, threadID);
  }

  // Trigger Words (Non-Command)
  if (!body.startsWith(prefix)) {
    const triggers = {
      'mkc': '😈 BOL MC KYAA KAAM HAI MADARCHOD 😈',
      'bc': '😈 TERI MA KI CHUT BC 😈',
      'randi': '🤡 TU RANDI TERI NAANI RANDI TERI PURI NASL RANDI 🤡',
      'chutiya': '😭 TU CHUTIYON KA BAAP HAI SALE 😭',
      'bot': ['😈 BOL NA MADARCHOD KYAA KAAM HAI 😈', '😈 WALEED LEGEND KA BOT HU MC 😈', '😈 TAG MAT KAR RANDI KE 😈', '😈 HAAN BOL NA GANDU 😈'][Math.floor(Math.random()*4)],
      'legend': '🔥 WALEED LEGEND IS MY OWNER 🔥 RESPECT HIM OR MAAR KHAEGA 🔥'
    };

    for (let [word, reply] of Object.entries(triggers)) {
      if (lower.includes(word)) {
        const msg = await formatLegendMessage(api, event, typeof reply === 'string' ? reply : reply);
        return api.sendMessage(msg, threadID);
      }
    }
    return;
  }

  // Commands
  const args = body.slice(prefix.length).trim().split(/ +/);
  const cmd = args.shift().toLowerCase();

  let reply = '';

  switch (cmd) {
    case 'help':
      reply = `😈 WALEED LEGEND BOT COMMANDS 😈

🔥 OWNER: WALEED LEGEND™

${prefix}help - Ye list
${prefix}tid - Group ID
${prefix}uid - User ID (mention)
${prefix}group on <name> - GC Name Lock
${prefix}group off - Unlock
${prefix}nick on <name> - Sabka Nick Lock
${prefix}nick off - Unlock
${prefix}botnick <name> - Bot ka nick change
${prefix}target on <file> <name> - Target Attack
${prefix}target off - Stop
${prefix}spam <number> <msg> - Spam bomb
${prefix}kick @tag - Kick member
${prefix}add @tag - Add back
${prefix}alive - Bot status
${prefix}owner - Owner info`;
      break;

    case 'alive':
      reply = `😈 WALEED LEGEND KA BOT FULL ACTIVE HAI 🔥\nOWNER: WALEED LEGEND™\nGROUPS: ${joinedGroups.size}\nUPTIME: 24/7`;
      break;

    case 'owner':
      reply = `🔥 MY OWNER IS WALEED LEGEND ™ 🔥\nWORLD BEST CODER & DARINDA 🔥\nSAB USKE AAGE GANDU HAI 🔥`;
      break;

    case 'tid':
      reply = `Group ID: ${threadID}`;
      break;

    case 'uid':
      const uid = mentions && Object.keys(mentions)[0] ? Object.keys(mentions)[0] : senderID;
      reply = `User ID: ${uid}`;
      break;

    case 'spam':
      if (!isAdmin) return;
      if (!args[1]) return api.sendMessage("Format: /spam <count> <message>", threadID);
      let count = parseInt(args[0]);
      let spamMsg = args.slice(1).join(" ");
      if (count > 100) count = 100;
      for (let i = 0; i < count; i++) {
        api.sendMessage(spamMsg, threadID);
        await new Promise(r => setTimeout(r, 800));
      }
      return;

    case 'kick':
      if (!isAdmin) return;
      if (!mentions) return api.sendMessage("Tag kisiko", threadID);
      const victim = Object.keys(mentions)[0];
      api.removeUserFromGroup(victim, threadID);
      reply = `😈 ${victim} ko bahar phenk diya gand marrne!`;
      break;

    case 'target':
      if (!isAdmin) return;
      if (args[0] === 'off') {
        if (targetSessions[threadID]) {
          clearInterval(targetSessions[threadID].interval);
          delete targetSessions[threadID];
          reply = "🛑 Target Attack Band Kar Diya";
        }
      } else if (args[0] === 'on') {
        const fileNum = args[1];
        const name = args.slice(2).join(" ");
        if (!fileNum || !name) return api.sendMessage("Format: /target on <file_no> <name>", threadID);
        const filePath = path.join(__dirname, `np${fileNum}.txt`);
        if (!fs.existsSync(filePath)) return api.sendMessage("File nahi mili bhai", threadID);

        const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
        let i = 0;
        const interval = setInterval(() => {
          api.sendMessage(`${name} ${lines[i++ % lines.length]}`, threadID);
        }, 9000);

        targetSessions[threadID] = { interval };
        reply = `💣 TARGET LOCKED: ${name}\nFile: np${fileNum}.txt\nAttack Shuru 🔥`;
      }
      break;

    case 'botnick':
      if (!isAdmin) return;
      const newNick = args.join(" ");
      if (!newNick) return api.sendMessage("Nick daal", threadID);
      botNickname = newNick;
      fs.writeFileSync('config.json', JSON.stringify({ botNickname, ownerName, cookies: currentCookies }, null, 2));
      setBotNickEverywhere();
      reply = `😈 Bot ka nick badal diya: ${newNick}`;
      break;

    default:
      reply = isAdmin 
        ? `Invalid command bhosdike! ${prefix}help dekh le madarchod` 
        : `Teri maa ka bhosda! WALEED LEGEND ke bot se baat kar raha hai samjha?`;
  }

  if (reply) {
    const final = await formatLegendMessage(api, event, reply);
    api.sendMessage(final, threadID);
  }
}

// === AUTO LOCKS ===
async function handleNameChange(api, event) {
  if (lockedGroups[event.threadID] && event.authorID !== adminID) {
    api.setTitle(lockedGroups[event.threadID], event.threadID);
    api.sendMessage("😈 GROUP NAME CHANGE KAREGA? TERI MAA CHOD DUNGA!", event.threadID);
  }
}

async function handleNickChange(api, event) {
  const botID = api.getCurrentUserID();
  if (event.participantID === botID && event.authorID !== adminID) {
    api.changeNickname(botNickname, event.threadID, botID);
  }
  if (lockedNicknames[event.threadID] && event.authorID !== adminID) {
    api.changeNickname(lockedNicknames[event.threadID], event.threadID, event.participantID);
  }
}

async function handleBotAdded(api, event) {
  const botID = api.getCurrentUserID();
  if (event.logMessageData.addedParticipants.some(p => p.userFbId === botID)) {
    await api.changeNickname(botNickname, event.threadID, botID);
    api.sendMessage(`😈 WALEED LEGEND KA DARINDA BOT AA GAYA 🔥\nSAB HATER KI MAA CHODNE!\nOWNER: WALEED LEGEND™`, event.threadID);
  }
}

// === WEB DASHBOARD ===
app.use(express.static('public'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.get('/', (req, res) => res.sendFile(__dirname + '/public/index.html'));

app.post('/login', (req, res) => {
  try {
    const cookies = JSON.parse(req.body.cookies);
    adminID = req.body.adminID;
    prefix = req.body.prefix || '/';

    if (!adminID || !cookies.length) throw "Invalid data";

    fs.writeFileSync('config.json', JSON.stringify({ cookies, botNickname, ownerName }, null, 2));
    res.send(`
      <h1 style="color: lime; font-family: consolas">WALEED LEGEND BOT STARTED SUCCESSFULLY</h1>
      <h2>OWNER: WALEED LEGEND™</h2>
      <script>setTimeout(() => location.href='/', 3000)</script>
    `);
    initializeBot(cookies);
  } catch (e) {
    res.status(400).send("Invalid Cookies or Admin ID");
  }
});

server.listen(process.env.PORT || 8080, () => {
  emitLog(`🚀 WALEED LEGEND BOT SERVER LIVE ON PORT ${process.env.PORT || 8080}`);
});

// Auto Load Config
if (fs.existsSync('config.json')) {
  try {
    const config = JSON.parse(fs.readFileSync('config.json'));
    botNickname = config.botNickname || botNickname;
    ownerName = config.ownerName || ownerName;
    if (config.cookies) {
      adminID = config.adminID || null; // adminID abhi dashboard se lenge
      emitLog('Config loaded. Put cookies & admin ID on dashboard.');
    }
  } catch (e) { emitLog('Config error', true); }
}
