import { SlashCommandBuilder } from 'discord.js';
import type { Command, ComponentHandler } from '../../../src/discord/types.js';

const command: Command = {
  data: new SlashCommandBuilder().setName('ping').setDescription('Проверка'),
  async execute(i) {
    await i.reply('pong');
  },
};
export default command;
export const components: ComponentHandler[] = [{ prefix: 'ping', async handle() {} }];
