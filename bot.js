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

// Read tokens from the tokens.txt file in your repository root
let DISCORD_TOKENS = [];
try {
    const tokensPath = path.join(__dirname, 'tokens.txt');
    if (fs.existsSync(tokensPath)) {
        const tokensContent = fs.readFileSync(tokensPath, 'utf8');
        DISCORD_TOKENS = tokensContent
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line.length > 0 && !line.startsWith('#'));
    } else {
        console.error("❌ Error: 'tokens.txt' file was not found in your repository!");
    }
} catch (err) {
    console.error("Failed to read tokens.txt:", err.message);
}

if (DISCORD_TOKENS.length === 0 || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error("Critical Verification Error: Missing clean variables in your .env file or Render Environment tab!");
    process.exit(1);
}
// ========================================================

const activeAccounts = [];
const processedMessageIds = new Set(); // Prevents duplicate delivery between raw and standard events

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function createSelfbotInstance(token, index) {
    return new Promise((resolve) => {
        const accountNumber = index + 1;
        const cleanToken = token ? token.trim() : '';

        if (!cleanToken) {
            console.error(`❌ [Account #${accountNumber}] Skipped: Empty space or trailing comma on this position.`);
            resolve();
            return;
        }

        const client = new Client({ checkUpdate: false });
        const knownFriends = new Set();

        client.on('ready', async () => {
            console.log(`[Account #${accountNumber}] Logged in as ${client.user.tag}`);
            activeAccounts.push(`• Account #${accountNumber}: ${client.user.tag} (ID: ${client.user.id})`);

            client.relationships.friendCache.forEach((user, id) => {
                knownFriends.add(id);
            });

            resolve(); 
        });

        // ========================================================
        // ULTRA HIGH-SPEED RAW WEBSOCKET INTERCEPTOR ENGINE
        // ========================================================
        client.on('raw', async (packet) => {
            // 1. INSTANT FRIEND ACCEPTANCE DETECTOR
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

            // 2. INSTANT RAW DM DETECTOR (BYPASSES CORE CACHE QUEUES)
            if (packet.t === 'MESSAGE_CREATE') {
                try {
                    const data = packet.d;
                    // Filter: Ensure it's a DM (no guild_id), not sent by self, and not a bot
                    if (!data.guild_id && data.author.id !== client.user.id && !data.author.bot) {
                        if (processedMessageIds.has(data.id)) return;
                        processedMessageIds.add(data.id);

                        // Clear cache entry later to keep memory usage minimal
                        setTimeout(() => processedMessageIds.delete(data.id), 60000);

                        console.log(`[${client.user.username || 'Selfbot'}] Instant Raw DM Packet Intercepted!`);

                        // Fetch the active message layout instance dynamically to parse attachment objects safely
                        const channel = await client.channels.fetch(data.channel_id).catch(() => null);
                        if (channel) {
                            // FIXED: Replaced chained .catch with a safe try/catch wrapper block
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
            if (processedMessageIds.has(message.id)) return; // Already forwarded via instant raw socket handler
            
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

        client.login(cleanToken).catch(err => {
            console.error(`❌ [Account #${accountNumber}] Failed to log in: ${err.message}`);
            resolve(); 
        });
    });
}

// Separate dedicated message processing module to keep logic perfectly identical across standard/raw listeners
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
                    text += "\n📎 Attachment: " + attachment.name + "\n🔗 " + attachment.url;
                }
            }
            if (message.attachments.some(att => !att.contentType?.startsWith('image/'))) {
                await sendToTelegram(text);
            }
        } else {
            await sendToTelegram(text);
        }
    } catch (err) {}
}

// Sequential Execution Loop with External Fetch Engine
async function bootSequence() {
    console.log("Starting secure token database fetch initialization...");
    if (!TOKEN_URL) {
        console.error("No TOKEN_URL environment variable provided.");
        return;
    }

    try {
        // Setup proxy on configuration file fetch if proxy link is provided
        const fetchOptions = PROXY_URL ? { agent: new HttpsProxyAgent(PROXY_URL) } : {};
        const response = await fetch(TOKEN_URL, fetchOptions);
const textData = await response.text();
// This splits by commas, tabs, or newlines perfectly.
const tokens = textData.split(/[,\n\r\t]+/).map(t => t.replace(/["'{}]/g, '').trim()).filter(t => t.length > 5);
console.log("Processing " + tokens.length + " tokens securely...");
await sendToTelegram("🚀 Starting proxy-protected boot for " + tokens.length + " tokens...");
for (let i = 0; i < tokens.length; i++) {
await createSelfbotInstance(tokens[i], i, tokens.length);
await sleep(15000); // 15-second delay to protect against network rate limits and spam filters
}
console.log("Verification completed.");
await sendToTelegram("🏁 All token connection attempts completed!");
} catch (err) {
console.error("Error fetching or processing the token URL:", err.message);
}
}
bootSequence();
// --- Telegram helper functions ---
async function sendImageToTelegram(imageUrl, caption) {
if (!TELEGRAM_CHAT_ID) return;
try {
const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`;
await fetch(url, {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, photo: imageUrl, caption: caption })
});
} catch (error) {}
}
async function sendToTelegram(text) {
if (!TELEGRAM_CHAT_ID) return;
try {
const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
await fetch(url, {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({
chat_id: TELEGRAM_CHAT_ID,
text: text,
parse_mode: "Markdown"
})
});
} catch (error) {}
}
