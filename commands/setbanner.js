'use strict';

module.exports = {
  name: 'setbanner',
  description: 'تغيير بنر البوت (يعتمد على صلاحيات الحساب/التطبيق في ديسكورد)',
  async execute(message, args, _cfg, _saveConfig) {
    const url = message.attachments.first()?.proxyURL || message.attachments.first()?.url || args[0];
    if (!url) {
      await message.reply('ارفق صورة البنر أو أرسل رابطًا لها.');
      return;
    }
    const res = await fetch(url);
    if (!res.ok) {
      await message.reply('ما قدرت أحمّل صورة البنر.');
      return;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    try {
      await message.client.user.setBanner(buf);
      await message.reply('تم تحديث البنر (إذا كانت المنصة تسمح بحساب بوت يعرض بنرًا).');
    } catch (e) {
      const msg =
        e?.message ||
        'ديسكورد رفض تغيير البنر. غالبًا لازم ميزات إضافية على التطبيق أو الصورة لا تتوافق مع المتطلبات.';
      await message.reply(`فشل: ${msg}`);
    }
  },
};
