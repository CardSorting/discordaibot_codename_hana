const pinoLogger = require('./logger');

class UserLastChannelMapCache {
    constructor() {
        this.cache = new Map();
    }

    set(userId, channelId, channelType, query, guildId) {
        if (typeof userId !== 'string' || typeof channelId !== 'string' || typeof query !== 'string' || typeof guildId !== 'string') {
            throw new Error('Invalid parameters provided.');
        }

        this.cache.set(userId, { channelId, channelType, query, guildId });
        pinoLogger.info(`Cache set for user ${userId}`);
    }

    get(userId) {
        if (typeof userId !== 'string') {
            throw new Error('Invalid userId provided for cache retrieval.');
        }
        return this.cache.get(userId);
    }

    clearUserCache(userId) {
        this.cache.delete(userId);
        pinoLogger.info(`Cache cleared for user ${userId}.`);
    }
}

module.exports = new UserLastChannelMapCache();