import { errorReply, replyEphemeral } from './ui.js';
export const STALE_COMPONENT_TEXT = 'Эта кнопка устарела 🫧';
/** Splits `prefix:arg1:arg2` → ['prefix', ['arg1','arg2']]. */
export function parseCustomId(id) {
    const [prefix = '', ...args] = id.split(':');
    return [prefix, args];
}
export function createInteractionHandler(reg, ctx) {
    return async (i) => {
        try {
            if (i.isChatInputCommand()) {
                const cmd = reg.commands.get(i.commandName);
                if (!cmd)
                    return void (await replyEphemeral(i, 'Неизвестная команда.'));
                await cmd.execute(i, ctx);
                return;
            }
            if (i.isAutocomplete()) {
                const cmd = reg.commands.get(i.commandName);
                if (cmd?.autocomplete)
                    await cmd.autocomplete(i, ctx);
                else
                    await i.respond([]);
                return;
            }
            if (i.isMessageComponent() || i.isModalSubmit()) {
                const [prefix, args] = parseCustomId(i.customId);
                const h = reg.components.get(prefix);
                if (!h)
                    return void (await replyEphemeral(i, STALE_COMPONENT_TEXT));
                await h.handle(i, args, ctx);
            }
        }
        catch (err) {
            console.error('[router] interaction failed:', err);
            if (i.isAutocomplete()) {
                await i.respond([]).catch(() => undefined);
                return;
            }
            await errorReply(i);
        }
    };
}
//# sourceMappingURL=router.js.map