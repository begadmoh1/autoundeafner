'use strict';

module.exports = {
  name: 'setname',
  description: 'تغيير اسم البوت',
  async execute(message, args, _cfg, _saveConfig) {
    const name = args.join(' ').trim();
    if (!name) {
      await message.reply('اكتب الاسم بعد الأمر.');
      return;
    }
    if (name.length < 2 || name.length > 32) {
      await message.reply('الاسم لازم يكون بين حرفين و 32 حرف (حد ديسكورد).');
      return;
    }
    await message.client.user.setUsername(name);
    await message.reply('تم تغيير الاسم.');
  },
};
