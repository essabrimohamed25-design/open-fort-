const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionsBitField, ModalBuilder, TextInputBuilder, TextInputStyle, Partials, Collection, ActivityType } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, getVoiceConnection } = require('@discordjs/voice');
const fs = require('fs');
const ytdl = require('ytdl-core');
const ms = require('ms');
const moment = require('moment');
const axios = require('axios');

// Create Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Channel]
});

// Collections for commands and data
client.commands = new Collection();
client.cooldowns = new Collection();
client.voiceConnections = new Map();
client.tickets = new Map();
client.musicQueues = new Map();

// Helper function to check admin permissions
function isAdmin(member) {
    return member.permissions.has(PermissionsBitField.Flags.Administrator) || member.permissions.has(PermissionsBitField.Flags.ManageGuild);
}

// Helper function to log actions
async function logAction(guild, action, details) {
    const logChannel = guild.channels.cache.find(ch => ch.name === 'bot-logs');
    if (!logChannel) return;
    
    const embed = new EmbedBuilder()
        .setColor(0x2b2d31)
        .setTitle(`📋 ${action}`)
        .setDescription(details)
        .setTimestamp()
        .setFooter({ text: guild.name, iconURL: guild.iconURL() });
    
    await logChannel.send({ embeds: [embed] });
}

// Welcome system
client.on('guildMemberAdd', async (member) => {
    const welcomeChannel = member.guild.channels.cache.find(ch => ch.name === 'welcome');
    if (welcomeChannel) {
        const welcomeEmbed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle(`✨ Welcome to ${member.guild.name}!`)
            .setDescription(`Hey ${member.user}, welcome to our community! We're glad to have you here.`)
            .setThumbnail(member.user.displayAvatarURL())
            .addFields(
                { name: '📅 Account Created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
                { name: '👥 Member Count', value: `${member.guild.memberCount}`, inline: true }
            )
            .setTimestamp();
        
        welcomeChannel.send({ content: `${member.user}`, embeds: [welcomeEmbed] });
    }
    
    await logAction(member.guild, 'Member Joined', `${member.user.tag} joined the server`);
});

// Goodbye system
client.on('guildMemberRemove', async (member) => {
    const goodbyeChannel = member.guild.channels.cache.find(ch => ch.name === 'goodbye');
    if (goodbyeChannel) {
        const goodbyeEmbed = new EmbedBuilder()
            .setColor(0xff0000)
            .setTitle(`👋 Goodbye!`)
            .setDescription(`${member.user.tag} has left the server. We'll miss you!`)
            .setThumbnail(member.user.displayAvatarURL())
            .addFields(
                { name: '📊 New Member Count', value: `${member.guild.memberCount}`, inline: true }
            )
            .setTimestamp();
        
        goodbyeChannel.send({ embeds: [goodbyeEmbed] });
    }
    
    await logAction(member.guild, 'Member Left', `${member.user.tag} left the server`);
});

// Music queue system
class MusicQueue {
    constructor() {
        this.queue = [];
        this.current = null;
        this.player = null;
        this.connection = null;
    }
    
    add(song) {
        this.queue.push(song);
    }
    
    next() {
        this.current = this.queue.shift();
        return this.current;
    }
    
    clear() {
        this.queue = [];
        this.current = null;
    }
}

// Command handler
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.guild) return;
    if (!message.content.startsWith('-')) return;
    
    const args = message.content.slice(1).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();
    
    // ============= MODERATION COMMANDS (15) =============
    
    // Kick command
    if (commandName === 'kick') {
        if (!isAdmin(message.member)) {
            return message.reply('❌ You need administrator permissions!');
        }
        const member = message.mentions.members.first();
        if (!member) return message.reply('❌ Please mention a member to kick!');
        if (!member.kickable) return message.reply('❌ I cannot kick this member!');
        
        const reason = args.join(' ') || 'No reason provided';
        await member.kick(reason);
        message.reply(`✅ Kicked ${member.user.tag} | Reason: ${reason}`);
        await logAction(message.guild, 'Member Kicked', `${member.user.tag} was kicked by ${message.author.tag}\nReason: ${reason}`);
    }
    
    // Ban command
    if (commandName === 'ban') {
        if (!isAdmin(message.member)) {
            return message.reply('❌ You need administrator permissions!');
        }
        const member = message.mentions.members.first();
        if (!member) return message.reply('❌ Please mention a member to ban!');
        if (!member.bannable) return message.reply('❌ I cannot ban this member!');
        
        const reason = args.join(' ') || 'No reason provided';
        await member.ban({ reason });
        message.reply(`✅ Banned ${member.user.tag} | Reason: ${reason}`);
        await logAction(message.guild, 'Member Banned', `${member.user.tag} was banned by ${message.author.tag}\nReason: ${reason}`);
    }
    
    // Purge command
    if (commandName === 'purge') {
        if (!isAdmin(message.member)) return message.reply('❌ You need administrator permissions!');
        const amount = parseInt(args[0]);
        if (isNaN(amount) || amount < 1 || amount > 100) return message.reply('❌ Please provide a number between 1-100!');
        
        await message.channel.bulkDelete(amount, true);
        const msg = await message.channel.send(`✅ Deleted ${amount} messages!`);
        setTimeout(() => msg.delete(), 3000);
    }
    
    // Mute command
    if (commandName === 'mute') {
        if (!isAdmin(message.member)) return message.reply('❌ You need administrator permissions!');
        const member = message.mentions.members.first();
        if (!member) return message.reply('❌ Please mention a member to mute!');
        
        const role = message.guild.roles.cache.find(r => r.name === 'Muted');
        if (!role) {
            await message.guild.roles.create({ name: 'Muted', permissions: [] });
        }
        await member.roles.add(role || message.guild.roles.cache.find(r => r.name === 'Muted'));
        message.reply(`✅ Muted ${member.user.tag}`);
    }
    
    // Unmute command
    if (commandName === 'unmute') {
        if (!isAdmin(message.member)) return message.reply('❌ You need administrator permissions!');
        const member = message.mentions.members.first();
        if (!member) return message.reply('❌ Please mention a member to unmute!');
        
        const role = message.guild.roles.cache.find(r => r.name === 'Muted');
        if (role) await member.roles.remove(role);
        message.reply(`✅ Unmuted ${member.user.tag}`);
    }
    
    // Warn command
    if (commandName === 'warn') {
        if (!isAdmin(message.member)) return message.reply('❌ You need administrator permissions!');
        const member = message.mentions.members.first();
        if (!member) return message.reply('❌ Please mention a member to warn!');
        const reason = args.slice(1).join(' ') || 'No reason';
        message.reply(`⚠️ Warned ${member.user.tag} | Reason: ${reason}`);
    }
    
    // Lock channel
    if (commandName === 'lock') {
        if (!isAdmin(message.member)) return message.reply('❌ You need administrator permissions!');
        await message.channel.permissionOverwrites.edit(message.guild.id, { SendMessages: false });
        message.reply('🔒 Channel locked!');
    }
    
    // Unlock channel
    if (commandName === 'unlock') {
        if (!isAdmin(message.member)) return message.reply('❌ You need administrator permissions!');
        await message.channel.permissionOverwrites.edit(message.guild.id, { SendMessages: true });
        message.reply('🔓 Channel unlocked!');
    }
    
    // Slowmode
    if (commandName === 'slowmode') {
        if (!isAdmin(message.member)) return message.reply('❌ You need administrator permissions!');
        const seconds = parseInt(args[0]);
        if (isNaN(seconds)) return message.reply('❌ Please provide seconds!');
        await message.channel.setRateLimitPerUser(seconds);
        message.reply(`⏱️ Slowmode set to ${seconds} seconds!`);
    }
    
    // ============= UTILITY COMMANDS (15) =============
    
    // User info
    if (commandName === 'userinfo') {
        const member = message.mentions.members.first() || message.member;
        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle(`👤 User Info - ${member.user.tag}`)
            .setThumbnail(member.user.displayAvatarURL())
            .addFields(
                { name: 'ID', value: member.id, inline: true },
                { name: 'Joined Server', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`, inline: true },
                { name: 'Account Created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
                { name: 'Roles', value: `${member.roles.cache.size} roles`, inline: true }
            )
            .setTimestamp();
        message.reply({ embeds: [embed] });
    }
    
    // Server info
    if (commandName === 'serverinfo') {
        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle(`📊 Server Info - ${message.guild.name}`)
            .setThumbnail(message.guild.iconURL())
            .addFields(
                { name: 'Owner', value: `<@${message.guild.ownerId}>`, inline: true },
                { name: 'Members', value: `${message.guild.memberCount}`, inline: true },
                { name: 'Channels', value: `${message.guild.channels.cache.size}`, inline: true },
                { name: 'Roles', value: `${message.guild.roles.cache.size}`, inline: true },
                { name: 'Created', value: `<t:${Math.floor(message.guild.createdTimestamp / 1000)}:R>`, inline: true }
            );
        message.reply({ embeds: [embed] });
    }
    
    // Avatar command
    if (commandName === 'avatar') {
        const user = message.mentions.users.first() || message.author;
        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle(`${user.tag}'s Avatar`)
            .setImage(user.displayAvatarURL({ size: 1024, dynamic: true }))
            .setFooter({ text: 'Click the image to view full size' });
        message.reply({ embeds: [embed] });
    }
    
    // Ping command
    if (commandName === 'ping') {
        const sent = await message.reply('Pinging...');
        const latency = sent.createdTimestamp - message.createdTimestamp;
        sent.edit(`🏓 Pong!\nBot Latency: ${latency}ms\nAPI Latency: ${client.ws.ping}ms`);
    }
    
    // Weather command
    if (commandName === 'weather') {
        const city = args.join(' ');
        if (!city) return message.reply('❌ Please provide a city name!');
        try {
            const response = await axios.get(`https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=YOUR_API_KEY&units=metric`);
            const data = response.data;
            const embed = new EmbedBuilder()
                .setColor(0x00ffff)
                .setTitle(`🌤️ Weather in ${data.name}`)
                .addFields(
                    { name: 'Temperature', value: `${data.main.temp}°C`, inline: true },
                    { name: 'Feels Like', value: `${data.main.feels_like}°C`, inline: true },
                    { name: 'Humidity', value: `${data.main.humidity}%`, inline: true },
                    { name: 'Wind Speed', value: `${data.wind.speed} m/s`, inline: true }
                )
                .setTimestamp();
            message.reply({ embeds: [embed] });
        } catch (error) {
            message.reply('❌ City not found!');
        }
    }
    
    // Server stats
    if (commandName === 'stats') {
        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('📈 Bot Statistics')
            .addFields(
                { name: 'Servers', value: `${client.guilds.cache.size}`, inline: true },
                { name: 'Users', value: `${client.users.cache.size}`, inline: true },
                { name: 'Channels', value: `${client.channels.cache.size}`, inline: true },
                { name: 'Uptime', value: `${Math.floor(client.uptime / 86400000)}d ${Math.floor(client.uptime / 3600000) % 24}h ${Math.floor(client.uptime / 60000) % 60}m`, inline: true },
                { name: 'Node Version', value: process.version, inline: true }
            )
            .setTimestamp();
        message.reply({ embeds: [embed] });
    }
    
    // Calculate command
    if (commandName === 'calc') {
        const expression = args.join(' ');
        if (!expression) return message.reply('❌ Please provide a calculation!');
        try {
            const result = eval(expression);
            message.reply(`📱 Result: ${result}`);
        } catch (error) {
            message.reply('❌ Invalid expression!');
        }
    }
    
    // Random number
    if (commandName === 'random') {
        const min = parseInt(args[0]) || 1;
        const max = parseInt(args[1]) || 100;
        const random = Math.floor(Math.random() * (max - min + 1)) + min;
        message.reply(`🎲 Random number between ${min} and ${max}: **${random}**`);
    }
    
    // Shorten URL
    if (commandName === 'shorten') {
        const url = args[0];
        if (!url) return message.reply('❌ Please provide a URL!');
        message.reply('⚠️ URL shortening requires an API key. Please configure TinyURL or Bitly API.');
    }
    
    // ============= FUN COMMANDS (10) =============
    
    // 8ball command
    if (commandName === '8ball') {
        const question = args.join(' ');
        if (!question) return message.reply('❌ Ask a question!');
        const responses = ['Yes', 'No', 'Maybe', 'Definitely', 'Absolutely not', 'Ask again later', 'Most likely', 'Outlook good'];
        const answer = responses[Math.floor(Math.random() * responses.length)];
        message.reply(`🎱 ${answer}`);
    }
    
    // Joke command
    if (commandName === 'joke') {
        const jokes = [
            'Why don\'t scientists trust atoms? Because they make up everything!',
            'What do you call a fake noodle? An impasta!',
            'Why did the scarecrow win an award? He was outstanding in his field!',
            'What do you call a bear with no teeth? A gummy bear!'
        ];
        message.reply(`😄 ${jokes[Math.floor(Math.random() * jokes.length)]}`);
    }
    
    // Meme command
    if (commandName === 'meme') {
        try {
            const response = await axios.get('https://meme-api.com/gimme');
            const meme = response.data;
            const embed = new EmbedBuilder()
                .setColor(0xff69b4)
                .setTitle(meme.title)
                .setImage(meme.url)
                .setFooter({ text: `👍 ${meme.ups} | 💬 ${meme.comments || 0}` });
            message.reply({ embeds: [embed] });
        } catch (error) {
            message.reply('❌ Could not fetch meme!');
        }
    }
    
    // Flip coin
    if (commandName === 'coinflip') {
        const result = Math.random() > 0.5 ? 'Heads' : 'Tails';
        message.reply(`🪙 You flipped **${result}**!`);
    }
    
    // Roll dice
    if (commandName === 'roll') {
        const sides = parseInt(args[0]) || 6;
        const result = Math.floor(Math.random() * sides) + 1;
        message.reply(`🎲 You rolled a **${result}** (1-${sides})!`);
    }
    
    // Cat fact
    if (commandName === 'catfact') {
        try {
            const response = await axios.get('https://catfact.ninja/fact');
            message.reply(`🐱 Cat Fact: ${response.data.fact}`);
        } catch (error) {
            message.reply('❌ Could not fetch cat fact!');
        }
    }
    
    // Dog picture
    if (commandName === 'dog') {
        try {
            const response = await axios.get('https://dog.ceo/api/breeds/image/random');
            const embed = new EmbedBuilder().setImage(response.data.message);
            message.reply({ embeds: [embed] });
        } catch (error) {
            message.reply('❌ Could not fetch dog image!');
        }
    }
    
    // ============= VOICE/MUSIC COMMANDS =============
    
    // Voice command - join and stay 24/7
    if (commandName === 'voice') {
        const voiceChannelId = args[0];
        if (!voiceChannelId) return message.reply('❌ Please provide a voice channel ID!');
        
        const voiceChannel = message.guild.channels.cache.get(voiceChannelId);
        if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) {
            return message.reply('❌ Invalid voice channel ID!');
        }
        
        try {
            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: message.guild.id,
                adapterCreator: message.guild.voiceAdapterCreator,
            });
            
            client.voiceConnections.set(message.guild.id, connection);
            message.reply(`✅ Joined voice channel ${voiceChannel.name} and will stay connected 24/7!`);
            
            // Keep connection alive
            connection.on(VoiceConnectionStatus.Disconnected, async () => {
                setTimeout(() => {
                    if (connection.state.status !== VoiceConnectionStatus.Connecting) {
                        connection.destroy();
                        client.voiceConnections.delete(message.guild.id);
                    }
                }, 30000);
            });
        } catch (error) {
            message.reply('❌ Could not join voice channel!');
        }
    }
    
    // Play music
    if (commandName === 'play') {
        const query = args.join(' ');
        if (!query) return message.reply('❌ Please provide a song name or URL!');
        
        const voiceChannel = message.member.voice.channel;
        if (!voiceChannel) return message.reply('❌ You need to be in a voice channel!');
        
        let queue = client.musicQueues.get(message.guild.id);
        if (!queue) {
            queue = new MusicQueue();
            client.musicQueues.set(message.guild.id, queue);
        }
        
        try {
            const songInfo = await ytdl.getInfo(query);
            const song = {
                title: songInfo.videoDetails.title,
                url: songInfo.videoDetails.video_url,
                duration: songInfo.videoDetails.lengthSeconds
            };
            
            queue.add(song);
            
            if (!queue.current) {
                playSong(message.guild, voiceChannel, queue);
            }
            
            message.reply(`✅ Added to queue: **${song.title}**`);
        } catch (error) {
            message.reply('❌ Could not find that song!');
        }
    }
    
    // Skip song
    if (commandName === 'skip') {
        const queue = client.musicQueues.get(message.guild.id);
        if (!queue || !queue.player) return message.reply('❌ Nothing is playing!');
        
        queue.player.stop();
        message.reply('⏭️ Skipped current song!');
    }
    
    // Stop music
    if (commandName === 'stop') {
        const queue = client.musicQueues.get(message.guild.id);
        if (queue) {
            queue.clear();
            if (queue.player) queue.player.stop();
            message.reply('⏹️ Stopped music and cleared queue!');
        }
    }
    
    // Leave voice channel
    if (commandName === 'leave') {
        const connection = getVoiceConnection(message.guild.id);
        if (connection) {
            connection.destroy();
            client.voiceConnections.delete(message.guild.id);
            message.reply('👋 Left voice channel!');
        } else {
            message.reply('❌ I\'m not in a voice channel!');
        }
    }
    
    // ============= TICKET SYSTEM =============
    
    // Create ticket
    if (commandName === 'ticket') {
        const category = message.guild.channels.cache.find(c => c.name === 'Tickets' && c.type === ChannelType.GuildCategory);
        if (!category) {
            await message.guild.channels.create({ name: 'Tickets', type: ChannelType.GuildCategory });
        }
        
        const ticketChannel = await message.guild.channels.create({
            name: `ticket-${message.author.username}`,
            type: ChannelType.GuildText,
            parent: category || message.guild.channels.cache.find(c => c.name === 'Tickets'),
            permissionOverwrites: [
                {
                    id: message.guild.id,
                    deny: [PermissionsBitField.Flags.ViewChannel],
                },
                {
                    id: message.author.id,
                    allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
                },
                {
                    id: client.user.id,
                    allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
                }
            ]
        });
        
        client.tickets.set(ticketChannel.id, { userId: message.author.id, created: Date.now() });
        
        const ticketEmbed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle('🎫 Support Ticket')
            .setDescription('Support team will be with you shortly. Please describe your issue.')
            .addFields({ name: 'Created by', value: message.author.tag, inline: true })
            .setTimestamp();
        
        const closeButton = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('close_ticket')
                    .setLabel('Close Ticket')
                    .setStyle(ButtonStyle.Danger)
            );
        
        await ticketChannel.send({ embeds: [ticketEmbed], components: [closeButton] });
        message.reply(`✅ Ticket created: ${ticketChannel}`);
    }
    
    // ============= EVENT COMMAND - Send message to all members =============
    
    if (commandName === 'event') {
        if (!isAdmin(message.member)) return message.reply('❌ You need administrator permissions!');
        const content = args.join(' ');
        if (!content) return message.reply('❌ Please provide a message or link to send!');
        
        const members = await message.guild.members.fetch();
        let sent = 0;
        let failed = 0;
        
        for (const [id, member] of members) {
            if (!member.user.bot) {
                try {
                    await member.send(content);
                    sent++;
                    await new Promise(resolve => setTimeout(resolve, 100)); // Rate limit protection
                } catch (error) {
                    failed++;
                }
            }
        }
        
        message.reply(`✅ Event message sent to ${sent} members! (${failed} failed - likely DMs disabled)`);
        await logAction(message.guild, 'Event Broadcast', `Message sent to ${sent} members\nContent: ${content.substring(0, 100)}`);
    }
    
    // ============= HELP MENU =============
    
    if (commandName === 'help' || commandName === 'commands') {
        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('📚 Bot Commands')
            .setDescription('Here are all available commands:')
            .addFields(
                { name: '🛡️ Moderation', value: '`-kick`, `-ban`, `-purge`, `-mute`, `-unmute`, `-warn`, `-lock`, `-unlock`, `-slowmode`', inline: false },
                { name: '📊 Utility', value: '`-userinfo`, `-serverinfo`, `-avatar`, `-ping`, `-weather`, `-stats`, `-calc`, `-random`, `-shorten`', inline: false },
                { name: '🎉 Fun', value: '`-8ball`, `-joke`, `-meme`, `-coinflip`, `-roll`, `-catfact`, `-dog`', inline: false },
                { name: '🎵 Music/Voice', value: '`-voice [channelID]`, `-play`, `-skip`, `-stop`, `-leave`', inline: false },
                { name: '🎫 Support', value: '`-ticket`, `-event [message]` (Admin only)', inline: false },
                { name: 'ℹ️ Info', value: '`-help`, `-commands`', inline: false }
            )
            .setFooter({ text: `Total Commands: 50+ | Use - before each command` });
        
        message.reply({ embeds: [embed] });
    }
});

// Button interaction handler for tickets
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    
    if (interaction.customId === 'close_ticket') {
        await interaction.reply('🔒 Closing ticket in 5 seconds...');
        setTimeout(async () => {
            await interaction.channel.delete();
        }, 5000);
    }
});

// Ready event
client.once('ready', async () => {
    console.log(`✅ ${client.user.tag} is online!`);
    console.log(`📊 Serving ${client.guilds.cache.size} servers`);
    console.log(`👥 Monitoring ${client.users.cache.size} users`);
    
    client.user.setPresence({
        activities: [{ name: '-help | Luxury Bot', type: ActivityType.Listening }],
        status: 'online'
    });
    
    // Create necessary channels
    for (const guild of client.guilds.cache.values()) {
        if (!guild.channels.cache.find(ch => ch.name === 'bot-logs')) {
            await guild.channels.create({ name: 'bot-logs', type: ChannelType.GuildText });
        }
        if (!guild.channels.cache.find(ch => ch.name === 'welcome')) {
            await guild.channels.create({ name: 'welcome', type: ChannelType.GuildText });
        }
        if (!guild.channels.cache.find(ch => ch.name === 'goodbye')) {
            await guild.channels.create({ name: 'goodbye', type: ChannelType.GuildText });
        }
    }
});

// Helper function to play songs
async function playSong(guild, voiceChannel, queue) {
    if (!queue.current) {
        queue.current = queue.next();
        if (!queue.current) return;
    }
    
    const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
    });
    
    const player = createAudioPlayer();
    queue.player = player;
    
    const stream = ytdl(queue.current.url, { filter: 'audioonly' });
    const resource = createAudioResource(stream);
    
    player.play(resource);
    connection.subscribe(player);
    
    player.on(AudioPlayerStatus.Idle, () => {
        queue.current = queue.next();
        if (queue.current) {
            playSong(guild, voiceChannel, queue);
        } else {
            connection.destroy();
        }
    });
}

// Login to Discord
const token = process.env.DISCORD_TOKEN;
if (!token) {
    console.error('❌ DISCORD_TOKEN environment variable not set!');
    process.exit(1);
}

client.login(token);
