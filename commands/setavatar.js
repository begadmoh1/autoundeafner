'use strict';

module.exports = {
  name: 'setavatar',
  description: 'تغيير صورة البوت',
  async execute(message, args, _cfg, _saveConfig) {
    const url = message.attachments.first()?.proxyURL || message.attachments.first()?.url || args[0];
    if (!url) {
      await message.reply('ارفق صورة مع الأمر أو أرسل رابط الصورة.');
      return;
    }
    const res = await fetch(url);
    if (!res.ok) {
      await message.reply('ما قدرت أحمّل الصورة من الرابط.');
      return;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    await message.client.user.setAvatar(buf);
    await message.reply('تم تغيير صورة البوت.');
  },
};
