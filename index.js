'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { Client, GatewayIntentBits, ChannelType, AuditLogEvent } = require('discord.js');

const configPath = path.join(__dirname, 'config.json');

function loadConfig() {
  const raw = fs.readFileSync(configPath, 'utf8');
  return JSON.parse(raw);
}

let config = loadConfig();

function saveConfig(partial) {
  config = { ...config, ...partial };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
}

const commands = new Map();
const commandsDir = path.join(__dirname, 'commands');

for (const file of fs.readdirSync(commandsDir)) {
  if (!file.endsWith('.js')) continue;
  const cmd = require(path.join(commandsDir, file));
  if (cmd?.name && typeof cmd.execute === 'function') {
    commands.set(cmd.name.toLowerCase(), cmd);
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

async function wasVoiceMovedToChannelBySomeoneElse(guild, memberUserId, destinationChannelId) {
  const destOf = (e) => e.extra?.channel?.id;
  const countOf = (e) => Number.parseInt(String(e.extra?.count ?? '1'), 10);

  for (let attempt = 0; attempt < 8; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 880 : 450));

    const res = await guild
      .fetchAuditLogs({
        limit: 50,
        type: AuditLogEvent.MemberMove,
      })
      .catch(() => null);

    if (!res) continue;

    for (const entry of res.entries.values()) {
      if (destOf(entry) !== destinationChannelId) continue;

      const stalenessMs = Date.now() - entry.createdTimestamp;
      if (stalenessMs > 14500 || stalenessMs < -2000) continue;

      if (entry.executorId === memberUserId) continue;

      const mentionsMember =
        entry.targetId == null || entry.targetId === memberUserId || entry.targetId === undefined;
      if (!mentionsMember) continue;

      const execIsOtherUser =
        typeof entry.executorId === 'string' && entry.executorId.length > 0;

      if (entry.targetId === memberUserId && execIsOtherUser) {
        return true;
      }

      const looseTrusted =
        attempt >= 1 &&
        stalenessMs <= 8000 &&
        countOf(entry) === 1 &&
        (entry.targetId == null ||
          execIsOtherUser ||
          entry.executorId == null ||
          typeof entry.executorId === 'undefined');

      if (looseTrusted && (entry.executorId ?? null) !== memberUserId) {
        return true;
      }

      let executorBot = false;
      if (execIsOtherUser) {
        const u =
          guild.client.users.cache.get(entry.executorId) ??
          (await guild.client.users.fetch(entry.executorId).catch(() => null));
        executorBot = Boolean(u?.bot);
      }
      if (attempt >= 1 && executorBot && stalenessMs <= 10000 && countOf(entry) <= 10) {
        return true;
      }
    }
  }

  return false;
}

async function purgeVoiceRoomChat(channel) {
  try {
    if (!channel?.messages) return;
    for (;;) {
      const batch = await channel.messages.fetch({ limit: 100 });
      if (batch.size === 0) break;
      for (const m of batch.values()) await m.delete().catch(() => null);
    }
  } catch {
  }
}

function startCleanupLoop() {
  setInterval(async () => {
    config = loadConfig();
    const vid = config.voiceRoomId;
    if (!vid) return;
    const gid = config.server;
    const guild = client.guilds.cache.get(gid);
    if (!guild) return;
    const ch = await guild.channels.fetch(vid).catch(() => null);
    if (!ch) return;
    if (ch.type !== ChannelType.GuildVoice && ch.type !== ChannelType.GuildStageVoice) return;
    if (typeof ch.send !== 'function') return;
    await purgeVoiceRoomChat(ch);
  }, 5 * 60 * 1000);
}

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  startCleanupLoop();
});

client.on('messageCreate', async (message) => {
  try {
    if (message.author.bot) return;
    if (!message.guild || message.guild.id !== String(config.server)) return;

    config = loadConfig();
    const prefix = config.prefix ?? '!';
    if (!message.content.startsWith(prefix)) return;

    const body = message.content.slice(prefix.length).trim();
    if (!body) return;

    const [name, ...rest] = body.split(/\s+/);
    const cmd = commands.get(name.toLowerCase());
    if (!cmd) return;

    const perms =
      typeof message.member?.permissions?.has === 'function'
        ? message.member.permissions
        : null;
    if (!perms?.has?.('Administrator') && !perms?.has?.('ManageGuild')) {
      await message.react('❌').catch(() => null);
      return;
    }

    await cmd.execute(message, rest, config, saveConfig);
  } catch (e) {
    console.error(e);
  }
});

client.on('voiceStateUpdate', async (oldState, newState) => {
  try {
    config = loadConfig();
    const guildId = String(config.server);
    const roomId = config.voiceRoomId;

    if (!guildId || !roomId) {
      console.log('[voice] skip: server or voiceRoomId not configured', { guildId, roomId });
      return;
    }
    if (newState.guild.id !== guildId) {
      console.log('[voice] skip: event is for a different guild', {
        eventGuild: newState.guild.id,
        configuredGuild: guildId,
      });
      return;
    }

    const member = newState.member ?? oldState.member;
    if (!member || member.user.bot) return;

    const destinationChannelId = newState.channelId;
    if (!destinationChannelId) {
      console.log('[voice] skip: member disconnected (no destination channel)', {
        user: member.user.tag,
      });
      return;
    }

    const leftConfiguredRoom =
      oldState.channelId === roomId && destinationChannelId !== roomId;
    if (!leftConfiguredRoom) {
      console.log('[voice] skip: not a move out of the configured room', {
        user: member.user.tag,
        from: oldState.channelId,
        to: destinationChannelId,
        configuredRoom: roomId,
      });
      return;
    }

    const hadServerDeaf = Boolean(oldState.serverDeaf);
    const hadServerMute = Boolean(oldState.serverMute);
    if (!hadServerDeaf && !hadServerMute) {
      console.log('[voice] skip: member had no server deaf/mute in the old state', {
        user: member.user.tag,
        serverDeaf: oldState.serverDeaf,
        serverMute: oldState.serverMute,
        selfDeaf: oldState.selfDeaf,
        selfMute: oldState.selfMute,
      });
      return;
    }

    const guild = oldState.guild;
    const movedBySomeoneElse = await wasVoiceMovedToChannelBySomeoneElse(
      guild,
      member.id,
      destinationChannelId,
    );
    if (!movedBySomeoneElse) {
      console.log('[voice] skip: could not confirm the move was done by someone else (audit log check failed)', {
        user: member.user.tag,
        destination: destinationChannelId,
      });
      return;
    }

    const notifyChannel = await guild.channels.fetch(destinationChannelId).catch(() => null);
    const canSpeakThere =
      notifyChannel &&
      (notifyChannel.type === ChannelType.GuildVoice ||
        notifyChannel.type === ChannelType.GuildStageVoice) &&
      typeof notifyChannel.send === 'function';

    const patch = {};
    if (hadServerDeaf) patch.deaf = false;
    if (hadServerMute) patch.mute = false;

    const editResult = await member.edit(patch).then(
      () => ({ ok: true }),
      (err) => ({ ok: false, err }),
    );
    if (!editResult.ok) {
      console.error('[voice] failed to undeafen/unmute member', {
        user: member.user.tag,
        patch,
        error: editResult.err?.message,
      });
    } else {
      console.log('[voice] undeafened/unmuted member', { user: member.user.tag, patch });
    }

    if (canSpeakThere) {
      const action =
        hadServerDeaf && hadServerMute
          ? 'undeafened and unmuted'
          : hadServerDeaf
            ? 'undeafened'
            : 'unmuted';
      await notifyChannel
        .send({ content: `${member} you got ${action}` })
        .catch(() => null);
    }
  } catch (e) {
    console.error(e);
  }
});

const port = Number.parseInt(process.env.PORT ?? '5000', 10);
http
  .createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    const status = client.isReady() ? `online as ${client.user.tag}` : 'starting';
    res.end(`Bot ${status}\n`);
  })
  .listen(port, '0.0.0.0', () => {
    console.log(`Health endpoint listening on :${port}`);
  });

const token = process.env.DISCORD_TOKEN || config.token;
if (!token) {
  console.error('Missing DISCORD_TOKEN. Add it as a Replit secret.');
  process.exit(1);
}
client.login(token);
