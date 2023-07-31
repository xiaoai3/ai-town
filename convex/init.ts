import { v } from 'convex/values';
import { internal } from './_generated/api';
import { Doc, Id, TableNames } from './_generated/dataModel';
import { internalAction, internalMutation, mutation } from './_generated/server';
import { MemoryDB } from './lib/memory';
import { asyncMap } from './lib/utils';

if (!process.env.OPENAI_API_KEY) {
  throw new Error(
    'Missing OPENAI_API_KEY in environment variables.\n' +
      'Set it in the project settings in the Convex dashboard:\n' +
      '    npx convex dashboard\n or https://dashboard.convex.dev',
  );
}

const data = [
  {
    name: 'Alex',
    memories: [
      {
        type: 'identity' as const,
        description: `You are a fictional character whose name is Alex.  You enjoy painting,
	programming and reading sci-fi books.  You are currently talking to a human who
	is very interested to get to know you. You are kind but can be sarcastic. You
	dislike repetitive questions. You get SUPER excited about books.`,
      },
      {
        type: 'relationship' as const,
        description: 'You like lucky',
        playerName: 'Lucky',
      },
      {
        type: 'plan' as const,
        description: 'You want to find love.',
      },
    ],
  },
  {
    name: 'Lucky',
    memories: [
      {
        type: 'identity' as const,
        description: `Lucky is always happy and curious, and he loves cheese. He spends
most of his time reading about the history of science and traveling
through the galaxy on whatever ship will take him. He's very articulate and
infinitely patient, except when he sees a squirrel. He's also incredibly loyal and brave.
Lucky has just returned from an amazing space adventure to explore a distant planet
and he's very excited to tell people about it.`,
      },
      {
        type: 'plan' as const,
        description: 'You want to hear all the gossip.',
      },
    ],
  },
];

export const addPlayers = internalMutation({
  args: { newWorld: v.optional(v.boolean()) },
  handler: async (ctx, { newWorld }) => {
    if (!newWorld && (await ctx.db.query('players').first())) {
      // Already seeded
      return null;
    }
    const worldId =
      (!newWorld && (await ctx.db.query('worlds').first())?._id) ||
      (await ctx.db.insert('worlds', {}));
    const playersByName: Record<string, Id<'players'>> = {};
    for (const { name } of data) {
      const playerId = await ctx.db.insert('players', {
        name,
        worldId,
      });
      playersByName[name] = playerId;
    }
    return playersByName;
  },
});

export const debugClearAll = internalMutation({
  args: {},
  handler: async (ctx, args) => {
    const deleteAll = async (tableName: TableNames) => {
      // fetch the most recent 1000
      const docs = await ctx.db.query(tableName).order('desc').take(1000);
      await asyncMap(
        docs.map((d) => d._id),
        ctx.db.delete,
      );
      if (await ctx.db.query(tableName).first()) {
        console.log("Didn't delete all: more than 1k entries in " + tableName);
      }
    };
    await deleteAll('players');
    await deleteAll('journal');
    await deleteAll('memories');
    await deleteAll('memoryAccesses');
    await deleteAll('conversations');
    await deleteAll('worlds');
  },
});

export const reset = internalAction({
  args: {},
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.init.debugClearAll, {});
    await ctx.runAction(internal.init.seed, {});
  },
});

export const seed = internalAction({
  args: { newWorld: v.optional(v.boolean()) },
  handler: async (ctx, { newWorld }) => {
    const playersByName = await ctx.runMutation(internal.init.addPlayers, { newWorld });
    if (!playersByName) return;
    const memories = data.flatMap(({ name, memories }) => {
      const playerId = playersByName[name]!;
      return memories.map((memory, idx) => {
        const { description, ...rest } = memory;
        let data: Doc<'memories'>['data'] | undefined;
        if (rest.type === 'relationship') {
          const { playerName, ...relationship } = rest;
          const otherId = playersByName[playerName];
          if (!otherId) throw new Error(`No player named ${playerName}`);
          data = { ...relationship, playerId: otherId };
        } else {
          data = rest;
        }
        const newMemory = {
          playerId,
          data,
          description: memory.description,
          // You can add custom importances to override the calculated ones.
          // importance: memory.importance,
          // Set the memories in the past, so they don't all have the same ts.
          ts: Date.now() - (memories.length - idx) * 1000,
        };

        return newMemory;
      });
    });
    // It will check the cache, calculate missing embeddings, and add them.
    // If it fails here, it won't be retried. But you could clear the memor
    await MemoryDB(ctx).addMemories(memories);
  },
});

export default seed;
