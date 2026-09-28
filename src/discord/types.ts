import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  MessageComponentInteraction,
  ModalSubmitInteraction,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from 'discord.js';
import type { GameContext } from '../core/context.js';

/** Each file in src/discord/commands/ exports `default` of this type (+ optional `components`). */
export interface Command {
  data: SlashCommandBuilder | SlashCommandSubcommandsOnlyBuilder | SlashCommandOptionsOnlyBuilder;
  execute(i: ChatInputCommandInteraction, ctx: GameContext): Promise<void>;
  autocomplete?(i: AutocompleteInteraction, ctx: GameContext): Promise<void>;
}

/** Buttons + select menus + modals. customId = `${prefix}:${...args}`; prefix unique across the app. */
export interface ComponentHandler {
  prefix: string;
  handle(i: MessageComponentInteraction | ModalSubmitInteraction, args: string[], ctx: GameContext): Promise<void>;
}

/** Shape of a command module file. */
export interface CommandModule {
  default?: Command;
  components?: ComponentHandler[];
}
