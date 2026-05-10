'use strict';

const { ChannelType } = require('discord.js');

function parseChannelId(raw) {
  if (!raw) return null;
  const br = raw.match(/^<#(\d+)>$/);
  if (br) return br[1];
  if (/^\d{17,20}$/.test(raw)) return raw;
  return null;
}

module.exports = {
  name: 'setroom',
  description:
    'الروم «الانتظار»: إذا كان عليه دفن سيرفر وتم سحبه من هنا (بوت/مشرف) إلى روم صوت آخر يُزال الدفن فقط وليس الميوت؛ انتقالك بنفسك لا يفعّله.',
  async execute(message, args, _cfg, saveConfig) {
    const id = parseChannelId(args[0]);
    if (!id) {
      await message.reply('استخدم: `setroom` ثم منشن الروم أو ايدي الروم الصوتي.');
      return;
    }
    const ch = await message.guild.channels.fetch(id).catch(() => null);
    if (
      !ch ||
      (ch.type !== ChannelType.GuildVoice && ch.type !== ChannelType.GuildStageVoice)
    ) {
      await message.reply('القناة لازم تكون روم صوتي (أو ستيج).');
      return;
    }
    saveConfig({ voiceRoomId: ch.id });
    await message.reply(`تم حفظ الروم الصوتي: ${ch}`);
  },
};
