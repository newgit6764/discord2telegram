const { Client } = require('discord.js-selfbot-v13');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

// ========================================================
// HYBRID ENVIRONMENT VARIABLES ENGINE (LOCAL & CLOUD SAFE)
// ========================================================
const config = {};

// 1. Check if a local physical .env file exists on the hard disk (Local Mac fallback)
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

// 2. Map Render's native environment variables as the primary layer, falling back to disk if needed
const TELEGRAM_BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || config.TELEGRAM_BOT_TOKEN || '').replace(/[{}]/g, '').trim();
const TELEGRAM_CHAT_ID = (process.env.TELEGRAM_CHAT_ID || config.TELEGRAM_CHAT_ID || '').replace(/[{}]/g, '').trim();
const RAW_TOKENS = process.env.DISCORD_TOKEN || config.DISCORD_TOKEN || '';

const DISCORD_TOKENS = RAW_TOKENS ? RAW_TOKENS.split(',').map(token => token.replace(/[{}]/g, '').trim()) : [];

if (DISCORD_TOKENS.length === 0 || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error("Critical Verification Error: Missing clean variables in your .env file or Render Environment tab!");
    process.exit(1);
}
// ========================================================

// Track active accounts and total successful logins for the monitoring report
const activeAccounts = [];

// Helper function to insert a brief pause between logins to maintain perfect line order
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// 2. Wrapped Function returning a Promise to enforce strictly ordered sequential execution
function createSelfbotInstance(token, index) {
    return new Promise((resolve) => {
        const accountNumber = index + 1;
        const cleanToken = token ? token.trim() : '';

        // Safety check for empty entries caused by accidental double commas or spaces in .env
        if (!cleanToken) {
            console.error(`❌ [Account #${accountNumber}] Skipped: Empty space or trailing comma on this position.`);
            resolve();
            return;
        }

        const client = new Client({ checkUpdate: false });
        const knownFriends = new Set();

        client.on('ready', async () => {
            console.log(`[Account #${accountNumber}] Logged in as ${client.user.tag}`);
            
            // Add this account's details to our tracking list
            activeAccounts.push(`• Account #${accountNumber}: ${client.user.tag} (ID: ${client.user.id})`);

            // Pre-populate existing friends on login so old friends don't trigger updates
            client.relationships.friendCache.forEach((user, id) => {
                knownFriends.add(id);
            });

            resolve(); // Advance execution order to the next token on the line
        });

        // --- userUpdate listener tracks friend list changes instead of relationshipUpdate ---
        client.on('userUpdate', async () => {
            try {
                client.relationships.friendCache.forEach(async (friendUser, friendId) => {
                    if (!knownFriends.has(friendId)) {
                        // Cache the new entry immediately so it doesn't alert multiple times
                        knownFriends.add(friendId);
                        
                        console.log(`[${client.user.username}] New friend accepted: ${friendUser.tag}`);

                        const alertText = `🎉 Friend Request Accepted!\n\n` +
                                          `Account: ${client.user.tag}\n` +
                                          `New Friend: ${friendUser.tag} (${friendUser.id})`;
                        
                        await sendToTelegram(alertText);
                    }
                });
            } catch (error) {
                console.error(`[${client.user.username || 'Unknown'}] Error in userUpdate friend tracking:`, error);
            }
        });

        client.on('messageCreate', async (message) => {
            try {
                // --- FIXED ONLY: Instantly drops server text channels to kill the loops entirely ---
                if (message.channel.type !== 'DM' && message.channel.type !== 1) {
                    return;
                }

                // Debug logging specific to which account caught it (only fires for DMs now)
                console.log(`[${client.user.username}] Message received: Channel type: ${message.channel.type}, Author: ${message.author.tag}`);
                
                // Check for DMs - ignore bot authors and ignore message if the author is this specific client instance
                if (!message.author.bot && message.author.id !== client.user.id) {
                    console.log(`[${client.user.username}] DM detected! Forwarding to Telegram...`);
                    
                    // Handle text content
                    let text = `🎉 New Message Alert
                    DM to ${client.user.tag} \nfrom ${message.author.tag} \n(${message.author.id}):`;
                    if (message.content) {
                        text += `\n${message.content}`;
                    }
                    
                    // Handle attachments
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
                }
            } catch (error) {
                console.error(`[${client.user.username || 'Unknown'}] Error processing message:`, error);
            }
        });

        client.login(cleanToken).catch(err => {
            console.error(`❌ [Account #${accountNumber}] Failed to log in: ${err.message}`);
            resolve(); // Advance execution order even on errors so the code boot sequence stays active
        });
    });
}

// --- Synchronous boot sequence forces perfect chronological matching ---
async function bootSequence() {
    console.log(`🔄 Processing sequential login checks for ${DISCORD_TOKENS.length} tokens...`);
    
    for (let i = 0; i < DISCORD_TOKENS.length; i++) {
        await createSelfbotInstance(DISCORD_TOKENS[i], i);
        await sleep(1200); // 1.2-second safety delay protects your accounts from IP rate-limit grouping flags
    }
    
    console.log(`\n🏁 Verification completed. Pushing active dashboard list to Telegram...`);
    
    const startupMessage = `🤖 **Selfbots Online & Monitoring Active!**\n\n` +
                          `Total Accounts Monitored: **${activeAccounts.length} / ${DISCORD_TOKENS.length}**\n\n` +
                          `**Active Accounts:**\n${activeAccounts.length > 0 ? activeAccounts.join('\n') : 'None'}`;
    await sendToTelegram(startupMessage);
}

// Fire the sequential engine
bootSequence();

// --- Telegram helper functions ---

async function sendImageToTelegram(imageUrl, caption) {
    if (!TELEGRAM_CHAT_ID) {
        console.log('Would send image to Telegram:', imageUrl);
        return;
    }
    try {
        const url = `https://telegram.org{TELEGRAM_BOT_TOKEN}/sendPhoto`;
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
            await sendToTelegram(caption + `\n🖼️ Image: ${imageUrl}`);
        }
    } catch (error) {
        console.error('Error sending image to Telegram:', error);
        await sendToTelegram(caption + `\n🖼️ Image: ${imageUrl}`);
    }
}

async function sendToTelegram(text) {
    if (!TELEGRAM_CHAT_ID) {
        console.log('Would send to Telegram:', text);
        return;
    }
    try {
        const url = `https://telegram.org{TELEGRAM_BOT_TOKEN}/sendMessage`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID,
                text: text
            })
        });
        const result = await response.json();
        if (!result.ok) console.error('Telegram API error:', result);
    } catch (error) {
        console.error('Error sending to Telegram:', error);
    }
}
