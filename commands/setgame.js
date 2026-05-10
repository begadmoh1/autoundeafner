'use strict';

const { ActivityType } = require('discord.js');

module.exports = {
  name: 'setgame',
  description: 'حالة النشاط كـ Streaming (مع رابط اختياري للستريم)',
  async execute(message, args, cfg, saveConfig) {
    const trimmed = args.join(' ').trim();
    let streamUrl = cfg.streamingUrl || 'https://www.twitch.tv/discord';
    let activityName = trimmed;

    const urlMatch = trimmed.match(/\b(https?:\/\/\S+)/i);
    if (urlMatch) {
      streamUrl = urlMatch[1].replace(/[)>.,]+$/, '');
      activityName = trimmed.slice(0, trimmed.indexOf(urlMatch[1])).trim() || 'Live stream';
      saveConfig({ streamingUrl: streamUrl });
    }

    if (!activityName) activityName = 'Live stream';

    message.client.user.setPresence({
      activities: [{ name: activityName, type: ActivityType.Streaming, url: streamUrl }],
      status: 'online',
    });

    await message.reply(`تم ضبط الحالة كـ Streaming: **${activityName}**\nالرابط: ${streamUrl}`);
  },
};
