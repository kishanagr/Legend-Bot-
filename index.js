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

// --- GLOBAL STATE ---
let botAPI = null;
let adminID = null;
let prefix = '/';
let botNickname = '𝐃𝟑𝟑𝐏 𝐁𝟒𝐃𝐌𝟒𝐒𝐇';

let lockedGroups = {};
let lockedNicknames = {};
let lockedGroupPhoto = {};
let fightSessions = {};
let joinedGroups = new Set();
let targetSessions = {};
let nickLockEnabled = false;
let nickRemoveEnabled = false;
let gcAutoRemoveEnabled = false;
let currentCookies = null;
let reconnectAttempt = 0;
const signature = `\n                      ⚠️\n                  𝐃𝟑𝟑𝐏 𝐁𝟒𝐃𝐌𝟒𝐒𝐇 ⚠️`;
const separator = `\n---🤬---💸---😈--🤑---😈---👑---`;

// --- ANTI-OUT FEATURE ---
let antiOutEnabled = true; // Anti-out feature enabled by default

// --- ANTI-CALL FEATURE ---
let antiCallEnabled = true; // Anti-call feature enabled by default

// --- UTILITY FUNCTIONS ---
function emitLog(message, isError = false) {
  const logMessage = `[${new Date().toISOString()}] ${isError ? '❌ ERROR: ' : '✅ INFO: '}${message}`;
  console.log(logMessage);
  io.emit('botlog', logMessage);
}

function saveCookies() {
  if (!botAPI) {
    emitLog('❌ Cannot save cookies: Bot API not initialized.', true);
    return;
  }
  try {
    const newAppState = botAPI.getAppState();
    const configToSave = {
      botNickname: botNickname,
      cookies: newAppState
    };
    fs.writeFileSync('config.json', JSON.stringify(configToSave, null, 2));
    currentCookies = newAppState;
    emitLog('✅ AppState saved successfully.');
  } catch (e) {
    emitLog('❌ Failed to save AppState: ' + e.message, true);
  }
}

// --- BOT INITIALIZATION AND RECONNECTION LOGIC ---
function initializeBot(cookies, prefix, adminID) {
  emitLog('🚀 Initializing bot with ws3-fca...');
  currentCookies = cookies;
  reconnectAttempt = 0;

  login({ appState: currentCookies }, (err, api) => {
    if (err) {
      emitLog(`❌ Login error: ${err.message}. Retrying in 10 seconds.`, true);
      setTimeout(() => initializeBot(currentCookies, prefix, adminID), 10000);
      return;
    }

    emitLog('✅ Bot successfully logged in.');
    botAPI = api;
    botAPI.setOptions({
      selfListen: true,
      listenEvents: true,
      updatePresence: false
    });

    // Pehle thread list update karein, phir baaki kaam
    updateJoinedGroups(api);

    // Thoda sa delay ke baad baaki functions call karein
    setTimeout(() => {
        setBotNicknamesInGroups();
        sendStartupMessage();
        startListening(api);
    }, 5000); // 5 seconds ka delay

    // Periodically save cookies every 10 minutes
    setInterval(saveCookies, 600000);
  });
}

function startListening(api) {
  api.listenMqtt(async (err, event) => {
    if (err) {
      emitLog(`❌ Listener error: ${err.message}. Attempting to reconnect...`, true);
      reconnectAndListen();
      return;
    }

    try {
      if (event.type === 'message' || event.type === 'message_reply') {
        await handleMessage(api, event);
      } else if (event.logMessageType === 'log:thread-name') {
        await handleThreadNameChange(api, event);
      } else if (event.logMessageType === 'log:user-nickname') {
        await handleNicknameChange(api, event);
      } else if (event.logMessageType === 'log:thread-image') {
        await handleGroupImageChange(api, event);
      } else if (event.logMessageType === 'log:subscribe') {
        await handleBotAddedToGroup(api, event);
      } else if (event.logMessageType === 'log:unsubscribe') {
        await handleParticipantLeft(api, event);
      } else if (event.type === 'event' && event.logMessageType === 'log:thread-call') {
        await handleGroupCall(api, event);
      }
    } catch (e) {
      emitLog(`❌ Handler crashed: ${e.message}. Event: ${event.type}`, true);
    }
  });
}

function reconnectAndListen() {
  reconnectAttempt++;
  emitLog(`🔄 Reconnect attempt #${reconnectAttempt}...`, false);

  if (botAPI) {
    try {
      botAPI.stopListening();
    } catch (e) {
      emitLog(`❌ Failed to stop listener: ${e.message}`, true);
    }
  }

  if (reconnectAttempt > 5) {
    emitLog('❌ Maximum reconnect attempts reached. Restarting login process.', true);
    initializeBot(currentCookies, prefix, adminID);
  } else {
    setTimeout(() => {
      if (botAPI) {
        startListening(botAPI);
      } else {
        initializeBot(currentCookies, prefix, adminID);
      }
    }, 5000);
  }
}

async function setBotNicknamesInGroups() {
  if (!botAPI) return;
  try {
    const threads = await botAPI.getThreadList(100, null, ['GROUP']);
    const botID = botAPI.getCurrentUserID();
    for (const thread of threads) {
        try {
            const threadInfo = await botAPI.getThreadInfo(thread.threadID);
            if (threadInfo && threadInfo.nicknames && threadInfo.nicknames[botID] !== botNickname) {
                await botAPI.changeNickname(botNickname, thread.threadID, botID);
                emitLog(`✅ Bot's nickname set in group: ${thread.threadID}`);
            }
        } catch (e) {
            emitLog(`❌ Error setting nickname in group ${thread.threadID}: ${e.message}`, true);
        }
        await new Promise(resolve => setTimeout(resolve, 500)); // Thoda sa delay
    }
  } catch (e) {
    emitLog(`❌ Error getting thread list for nickname check: ${e.message}`, true);
  }
}

async function sendStartupMessage() {
  if (!botAPI) return;
  const startupMessage = `😈𝟒𝐋𝐋 𝐇𝟒𝐓𝟑𝐑𝐒 𝐊𝐈 𝐌𝟒𝟒 𝐂𝐇𝐎𝐃𝐍𝟑 𝐖𝟒𝐋𝟒 𝐃𝟑𝟑𝐏 𝐁𝐎𝐓 𝐇𝟑𝐑𝟑 😈`;
  try {
    const threads = await botAPI.getThreadList(100, null, ['GROUP']);
    for (const thread of threads) {
        botAPI.sendMessage(startupMessage, thread.threadID)
          .catch(e => emitLog(`❌ Error sending startup message to ${thread.threadID}: ${e.message}`, true));
        await new Promise(resolve => setTimeout(resolve, 500)); // Thoda sa delay
    }
  } catch (e) {
    emitLog(`❌ Error getting thread list for startup message: ${e.message}`, true);
  }
}

async function updateJoinedGroups(api) {
  try {
    const threads = await api.getThreadList(100, null, ['GROUP']);
    joinedGroups = new Set(threads.map(t => t.threadID));
    emitGroups();
    emitLog('✅ Joined groups list updated successfully.');
  } catch (e) {
    emitLog('❌ Failed to update joined groups: ' + e.message, true);
  }
}

// --- ANTI-OUT HANDLER ---
async function handleParticipantLeft(api, event) {
  if (!antiOutEnabled) return;
  
  try {
    const { threadID, logMessageData } = event;
    const leftParticipantID = logMessageData.leftParticipantFbId;
    
    // Don't add back if admin left
    if (leftParticipantID === adminID) return;
    
    // Don't add back if bot itself left
    const botID = api.getCurrentUserID();
    if (leftParticipantID === botID) return;
    
    emitLog(`🚫 Anti-out: User ${leftParticipantID} left group ${threadID}. Adding back...`);
    
    // Add the user back to the group
    await api.addUserToGroup(leftParticipantID, threadID);
    
    // Get user info for the message
    const userInfo = await api.getUserInfo(leftParticipantID);
    const userName = userInfo[leftParticipantID]?.name || "User";
    
    // Send warning message
    const warningMessage = await formatMessage(api, event, 
      `😈 𝐀𝐍𝐓𝐈-𝐎𝐔𝐓 𝐒𝐘𝐒𝐓𝐄𝐌 😈\n\n` +
      `@${userName} NIKALNE KI KOSHISH KI? 😼\n` +
      `TERI BHAN KI CHUT ME DEEP BADMASH KA LODA 😈\n` +
      `TU KHUD NIKALEGA NHI, HUM TERI BHAN NIKALENGE 😼`
    );
    
    await api.sendMessage(warningMessage, threadID);
    
    emitLog(`✅ Anti-out: Successfully added ${userName} back to group ${threadID}`);
    
  } catch (error) {
    emitLog(`❌ Anti-out error: ${error.message}`, true);
  }
}

// --- ANTI-CALL HANDLER ---
async function handleGroupCall(api, event) {
  if (!antiCallEnabled) return;
  
  try {
    const { threadID, logMessageData } = event;
    const callerID = logMessageData?.caller_id;
    
    // Don't block if admin is calling
    if (callerID === adminID) return;
    
    emitLog(`🚫 Anti-call: User ${callerID} started call in group ${threadID}. Ending call...`);
    
    // Get user info for the message
    const userInfo = await api.getUserInfo(callerID);
    const userName = userInfo[callerID]?.name || "User";
    
    // Send warning message
    const warningMessage = await formatMessage(api, event, 
      `😈 𝐀𝐍𝐓𝐈-𝐂𝐀𝐋𝐋 𝐒𝐘𝐒𝐓𝐄𝐌 😈\n\n` +
      `@${userName} CALL LAGANE KI KOSHISH KI? 😼\n` +
      `TERI BHEN KI CHUT ME DEEP BADMASH KA LODA 😈\n` +
      `YAHAN CALL NHI LAG SAKTI BSDK! 😼`
    );
    
    await api.sendMessage(warningMessage, threadID);
    
    // Note: Facebook API doesn't directly support ending calls, but we can send a warning
    emitLog(`✅ Anti-call: Warning sent to ${userName} for starting call in group ${threadID}`);
    
  } catch (error) {
    emitLog(`❌ Anti-call error: ${error.message}`, true);
  }
}

// --- WEB SERVER & DASHBOARD ---
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

app.post('/configure', (req, res) => {
  try {
    const cookies = JSON.parse(req.body.cookies);
    prefix = req.body.prefix || '/';
    adminID = req.body.adminID;

    if (!Array.isArray(cookies) || cookies.length === 0) {
      return res.status(400).send('Error: Invalid cookies format. Please provide a valid JSON array of cookies.');
    }
    if (!adminID) {
      return res.status(400).send('Error: Admin ID is required.');
    }

    res.send('Bot configured successfully! Starting...');
    initializeBot(cookies, prefix, adminID);
  } catch (e) {
    res.status(400).send('Error: Invalid configuration. Please check your input.');
    emitLog('Configuration error: ' + e.message, true);
  }
});

let loadedConfig = null;
try {
  if (fs.existsSync('config.json')) {
    loadedConfig = JSON.parse(fs.readFileSync('config.json'));
    if (loadedConfig.botNickname) {
      botNickname = loadedConfig.botNickname;
      emitLog('✅ Loaded bot nickname from config.json.');
    }
    if (loadedConfig.cookies && loadedConfig.cookies.length > 0) {
        emitLog('✅ Cookies found in config.json. Initializing bot automatically...');
        initializeBot(loadedConfig.cookies, prefix, adminID);
    } else {
        emitLog('❌ No cookies found in config.json. Please configure the bot using the dashboard.');
    }
  } else {
    emitLog('❌ No config.json found. You will need to configure the bot via the dashboard.');
  }
} catch (e) {
  emitLog('❌ Error loading config file: ' + e.message, true);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  emitLog(`✅ Server running on port ${PORT}`);
});

io.on('connection', (socket) => {
  emitLog('✅ Dashboard client connected');
  socket.emit('botlog', `Bot status: ${botAPI ? 'Started' : 'Not started'}`);
  socket.emit('groupsUpdate', Array.from(joinedGroups));
});

async function handleBotAddedToGroup(api, event) {
  const { threadID, logMessageData } = event;
  const botID = api.getCurrentUserID();

  if (logMessageData.addedParticipants.some(p => p.userFbId === botID)) {
    try {
      await api.changeNickname(botNickname, threadID, botID);
      await api.sendMessage(`😈𝟒𝐋𝐋 𝐇𝟒𝐓𝟑𝐑𝐒 𝐊𝐈 𝐌𝟒𝟒 𝐂𝐇𝐎𝐃𝐍𝟑 𝐖𝟒𝐋𝟒 𝐃𝟑𝟑𝐏 𝐁𝐎𝐓 𝐇𝟑𝐑𝟑 😈`, threadID);
      emitLog(`✅ Bot added to new group: ${threadID}. Sent welcome message and set nickname.`);
    } catch (e) {
      emitLog('❌ Error handling bot addition: ' + e.message, true);
    }
  }
}

function emitGroups() {
    io.emit('groupsUpdate', Array.from(joinedGroups));
}

// Updated helper function to format all messages
async function formatMessage(api, event, mainMessage) {
    const { senderID } = event;
    let senderName = 'User';
    try {
      const userInfo = await api.getUserInfo(senderID);
      senderName = userInfo && userInfo[senderID] && userInfo[senderID].name ? userInfo[senderID].name : 'User';
    } catch (e) {
      emitLog('❌ Error fetching user info: ' + e.message, true);
    }
    
    // Create the stylish, boxed-like mention text
    const styledMentionBody = `             [🦋°🫧•𖨆٭ ${senderName}꙳○𖨆°🦋]`;
    const fromIndex = styledMentionBody.indexOf(senderName);
    
    // Create the complete mention object
    const mentionObject = {
        tag: senderName,
        id: senderID,
        fromIndex: fromIndex
    };

    const finalMessage = `${styledMentionBody}\n${mainMessage}${signature}${separator}`;

    return {
        body: finalMessage,
        mentions: [mentionObject]
    };
}

async function handleMessage(api, event) {
  try {
    const { threadID, senderID, body, mentions } = event;
    const isAdmin = senderID === adminID;
    
    let replyMessage = '';
    let isReply = false;

    // First, check for mention of the admin - NEW FEATURE
    if (Object.keys(mentions || {}).includes(adminID)) {
      replyMessage = "😈 NAAM MAT LE DEEP JIJU JI BOL 😼";
      isReply = true;
    }

    // Now, check for commands and trigger words
    if (body) {
      const lowerCaseBody = body.toLowerCase();
      
      if (lowerCaseBody.includes('mkc')) {
        replyMessage = `😼𝐁𝐎𝐋 𝐍𝐀 𝐌𝐀𝐃𝐑𝐂𝐇𝐎𝐃𝐄 𝐓𝐄𝐑𝐈 𝐆𝐀𝐍𝐃 𝐌𝐀𝐀𝐑𝐔🙄`;
        isReply = true;
      } else if (lowerCaseBody.includes('randi')) {
        replyMessage = `😼𝐁𝐎𝐋 𝐓𝐄𝐑𝐈 𝐁𝐇𝐀𝐍 𝐂𝐇𝐎𝐃𝐔🙄👈🏻`;
        isReply = true;
      } else if (lowerCaseBody.includes('teri maa chod dunga')) {
        replyMessage = `🙄𝐋𝐔𝐋𝐋𝐈 𝐇𝐎𝐓𝐈 𝐍𝐇𝐈 𝐊𝐇𝐀𝐃𝐈 𝐁𝐀𝐀𝐓𝐄 𝐊𝐑𝐓𝐀 𝐁𝐃𝐈 𝐁𝐃𝐈 𝐒𝐈𝐃𝐄 𝐇𝐀𝐓 𝐁𝐒𝐃𝐊🙄👈🏻`;
        isReply = true;
      } else if (lowerCaseBody.includes('chutiya')) {
        replyMessage = `😼𝐓𝐔 𝐉𝐔𝐓𝐇𝐀 𝐓𝐄𝐑𝐄 𝐆𝐇𝐀𝐑 𝐖𝐀𝐋𝐄 𝐉𝐔𝐓𝐇𝐄 𝐉𝐔𝐓𝐇𝐈 𝐒𝐀𝐀𝐑𝐈 𝐊𝐇𝐔𝐃𝐀𝐀𝐈 𝐀𝐆𝐀𝐑 𝐂𝐇𝐔𝐓 𝐌𝐈𝐋𝐄 𝐓𝐄𝐑𝐈 𝐃𝐈𝐃𝐈 𝐊𝐈 𝐓𝐎 𝐉𝐀𝐌 𝐊𝐄 𝐊𝐑 𝐃𝐄 𝐓𝐄𝐑𝐀 𝐃𝟑𝟑𝐏 𝐁𝟒𝐃𝐌𝟒𝐒𝐇 𝐉𝐈𝐉𝐀 𝐂𝐇𝐔𝐃𝐀𝐀𝐈🙄👈🏻 `;
        isReply = true;
      } else if (lowerCaseBody.includes('boxdika')) {
        replyMessage = `😼𝐌𝐀𝐈𝐍 𝐋𝐎𝐍𝐃𝐀 𝐇𝐔 𝐕𝐀𝐊𝐈𝐋 𝐊𝐀 𝐋𝐀𝐍𝐃 𝐇𝐀𝐈 𝐌𝐄𝐑𝐀 𝐒𝐓𝐄𝐄𝐋 𝐊𝐀 𝐉𝐇𝐀 𝐌𝐔𝐭 𝐃𝐔 𝐖𝐀𝐇𝐀 𝐆𝐀𝐃𝐃𝐇𝐀 𝐊𝐇𝐔𝐃 𝐉𝐀𝐀𝐘𝐄 🙄𝐎𝐑 𝐓𝐔 𝐊𝐘𝐀 𝐓𝐄𝐑𝐈 𝐌𝐀 𝐁𝐇𝐄 𝐂𝐇𝐔𝐃 𝐉𝐀𝐀𝐘𝐄😼👈🏻`;
        isReply = true;
      } else if (lowerCaseBody.trim() === 'bot') {
        const botResponses = [
            `😈𝗕𝗢𝗟 𝗡𝗔 𝗠𝗔𝗗𝗥𝗖𝗛𝗢𝗗😼👈🏻`,
            `😈𝗕𝗢𝗧 𝗕𝗢𝗧 𝗞𝗬𝗨 𝗞𝗥 𝗥𝗛𝗔 𝗚𝗔𝗡𝗗 𝗠𝗔𝗥𝗩𝗔𝗡𝗔 𝗞𝗬𝗔 𝗕𝗢𝗧 𝗦𝗘 𝗕𝗦𝗗𝗞😈`,
            `🙄𝗞𝗜𝗦𝗞𝗜 𝗕𝗛𝗔𝗡 𝗞𝗜 𝗖𝗛𝗨𝗧 𝗠𝗘 𝗞𝗛𝗨𝗝𝗟𝗜 𝗛𝗘🙄👈🏻`,
            `🙈𝗝𝗔𝗬𝗔𝗗𝗔 𝗕𝗢𝗧 𝗕𝗢𝗧 𝗕𝗢𝗟𝗘𝗚𝗔 𝗧𝗢 𝗧𝗘𝗥𝗜 𝗚𝗔𝗔𝗡𝗗 𝗠𝗔𝗜 𝗣𝗘𝗧𝗥𝗢𝗟 𝗗𝗔𝗔𝗟 𝗞𝗘 𝗝𝗔𝗟𝗔 𝗗𝗨𝗚𝗔😬`,
            `🙄𝗠𝗨𝗛 𝗠𝗘 𝗟𝗘𝗚𝗔 𝗞𝗬𝗔 𝗠𝗖🙄👈🏻`,
            `🙄𝗕𝗢𝗧 𝗡𝗛𝗜 𝗧𝗘𝗥𝗜 𝗕𝗛𝗔𝗡 𝗞𝗜 𝗖𝗛𝗨𝗧 𝗠𝗔𝗔𝗥𝗡𝗘 𝗪𝗔𝗟𝗔 𝗛𝗨🙄👈🏻`,
            `🙄𝗔𝗕𝗬 𝗦𝗔𝗟𝗘 𝗦𝗨𝗞𝗛𝗘 𝗛𝗨𝗘 𝗟𝗔𝗡𝗗 𝗞𝗘 𝗔𝗗𝗛𝗠𝗥𝗘 𝗞𝗬𝗨 𝗕𝗛𝗢𝗞 𝗥𝗛𝗔🙄👈🏻`,
            `🙄𝗖𝗛𝗔𝗟 𝗔𝗣𝗡𝗜 𝗚𝗔𝗡𝗗 𝗗𝗘 𝗔𝗕 𝘿𝙀𝙀𝙋 𝘽4𝘿𝙈4𝙎𝙃 𝗞𝗢😼👈🏻`
        ];
        replyMessage = botResponses[Math.floor(Math.random() * botResponses.length)];
        isReply = true;
      }
      
      if (isReply) {
          const formattedReply = await formatMessage(api, event, replyMessage);
          return await api.sendMessage(formattedReply, threadID);
      }
    }

    // Now, handle commands
    if (!body || !body.startsWith(prefix)) return;
    const args = body.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // Command-specific replies will also be sent with the new format
    let commandReply = '';

    switch (command) {
      case 'group':
        await handleGroupCommand(api, event, args, isAdmin);
        return;
      case 'nickname':
        await handleNicknameCommand(api, event, args, isAdmin);
        return;
      case 'botnick':
        await handleBotNickCommand(api, event, args, isAdmin);
        return;
      case 'tid':
        commandReply = `Group ID: ${threadID}`;
        break;
      case 'uid':
        if (Object.keys(mentions || {}).length > 0) {
          const mentionedID = Object.keys(mentions)[0];
          commandReply = `User ID: ${mentionedID}`;
        } else {
          commandReply = `Your ID: ${senderID}`;
        }
        break;
      case 'fyt':
        await handleFightCommand(api, event, args, isAdmin);
        return;
      case 'stop':
        await handleStopCommand(api, event, isAdmin);
        return;
      case 'target':
        await handleTargetCommand(api, event, args, isAdmin);
        return;
      case 'help':
        await handleHelpCommand(api, event);
        return;
      case 'photolock':
        await handlePhotoLockCommand(api, event, args, isAdmin);
        return;
      case 'gclock':
        await handleGCLock(api, event, args, isAdmin);
        return;
      case 'gcremove':
        await handleGCRemove(api, event, isAdmin);
        return;
      case 'nicklock':
        await handleNickLock(api, event, args, isAdmin);
        return;
      case 'nickremoveall':
        await handleNickRemoveAll(api, event, isAdmin);
        return;
      case 'nickremoveoff':
        await handleNickRemoveOff(api, event, isAdmin);
        return;
      case 'status':
        await handleStatusCommand(api, event, isAdmin);
        return;
      case 'antiout':
        await handleAntiOutCommand(api, event, args, isAdmin);
        return;
      case 'anticall':
        await handleAntiCallCommand(api, event, args, isAdmin);
        return;
      case 'mentiontarget':
        await handleMentionTargetCommand(api, event, args, isAdmin);
        return;

      default:
        if (!isAdmin) {
          commandReply = `Teri ma ki chut 4 baar tera jija hu mc!`;
        } else {
          commandReply = `Ye h mera prefix ${prefix} ko prefix ho use lgake bole ye h mera prefix or AAHAN H3R3 mera jija hai ab bol na kya krega lode`;
        }
    }
    
    // Send final command reply with the new format
    if (commandReply) {
        const formattedReply = await formatMessage(api, event, commandReply);
        await api.sendMessage(formattedReply, threadID);
    }

  } catch (err) {
    emitLog('❌ Error in handleMessage: ' + err.message, true);
  }
}

// --- ANTI-OUT COMMAND HANDLER ---
async function handleAntiOutCommand(api, event, args, isAdmin) {
  const { threadID, senderID } = event;
  if (!isAdmin) {
    const reply = await formatMessage(api, event, "Permission denied, you are not the admin.");
    return await api.sendMessage(reply, threadID);
  }

  const subCommand = args.shift()?.toLowerCase();
  
  if (subCommand === 'on') {
    antiOutEnabled = true;
    const reply = await formatMessage(api, event, "😈 𝐀𝐍𝐓𝐈-𝐎𝐔𝐓 𝐒𝐘𝐒𝐓𝐄𝐌 𝐎𝐍 😈\n\nAb koi bhi group se nikalne ki koshish karega to usko wapas add kar diya jayega! 😼");
    await api.sendMessage(reply, threadID);
  } else if (subCommand === 'off') {
    antiOutEnabled = false;
    const reply = await formatMessage(api, event, "😈 𝐀𝐍𝐓𝐈-𝐎𝐔𝐓 𝐒𝐘𝐒𝐓𝐄𝐌 𝐎𝐅𝐅 😈\n\nAnti-out system band ho gaya hai.");
    await api.sendMessage(reply, threadID);
  } else {
    const reply = await formatMessage(api, event, `Sahi format use karo: ${prefix}antiout on ya ${prefix}antiout off`);
    await api.sendMessage(reply, threadID);
  }
}

// --- ANTI-CALL COMMAND HANDLER ---
async function handleAntiCallCommand(api, event, args, isAdmin) {
  const { threadID, senderID } = event;
  if (!isAdmin) {
    const reply = await formatMessage(api, event, "Permission denied, you are not the admin.");
    return await api.sendMessage(reply, 
