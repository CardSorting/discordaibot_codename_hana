const { EmbedBuilder } = require('discord.js');
const logger = require('./logger');
const QueryHandler = require('./QueryHandler');
const fs = require('fs');
const path = require('path');
const userLastChannelMapCache = require('./UserLastChannelMapCache');

class BotHandler {
    constructor(client) {
        this.validateClient(client);
        this.client = client;
        this.queryHandler = new QueryHandler();
        this.chatLogFilePath = path.join(__dirname, 'chatlog.json');
    }

    validateClient(client) {
        if (!client) {
            logger.error('BotHandler requires a valid Discord client instance.');
            throw new Error('Invalid Discord client instance.');
        }
    }

    async handleQuery(userId, query, guildId) {
        try {
            const result = await this.queryHandler.enqueue(userId, query, guildId);
            if (!result || !result.success) {
                throw new Error('Query processing failed');
            }
            await this.respondToUser(userId, query, result.response);
        } catch (error) {
            logger.error('Error in handleQuery', { userId, query, error: error.toString() });
        }
    }

    async respondToUser(userId, originalQuery, responseMessage) {
        try {
            const channelId = userLastChannelMapCache.getLastCommandChannelId(userId);
            if (!channelId) {
                logger.error('No channel ID found in cache', { userId });
                return;
            }

            const channel = await this.fetchChannel(channelId);
            const user = await this.fetchUser(userId);
            const embed = this.createResponseEmbed(originalQuery, responseMessage, user);
            await this.retrySend(channel, embed, 3);
        } catch (error) {
            logger.error('Error in respondToUser', {
                userId,
                originalQuery,
                responseMessage,
                error: { message: error.message, stack: error.stack }
            });
        } finally {
            userLastChannelMapCache.clearUserCache(userId);
        }
    }

    async fetchChannel(channelId) {
        try {
            return await this.client.channels.fetch(channelId);
        } catch (error) {
            logger.error('Error fetching channel', { channelId, error: error.toString() });
            throw error;
        }
    }

    async fetchUser(userId) {
        try {
            return await this.client.users.fetch(userId);
        } catch (error) {
            logger.error('Error fetching user', { userId, error: error.toString() });
            throw error;
        }
    }

    async retrySend(channel, embed, retries) {
        for (let i = 0; i < retries; i++) {
            try {
                await channel.send({ embeds: [embed] });
                logger.info(`Message successfully sent to channel ${channel.id}`);
                break;
            } catch (error) {
                logger.error(`Attempt ${i + 1} failed for sending response`, { channelId: channel?.id, error: error.toString() });
                if (i === retries - 1) {
                    throw error;
                }
            }
        }
    }

    createResponseEmbed(query, responseMessage, user) {
        return new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('Seraphina Says')
            .setFooter({ text: `Requested by ${user?.tag}`, iconURL: user?.displayAvatarURL() })
            .setTimestamp()
            .addFields(
                { name: 'Your Query', value: query || 'No query provided' },
                { name: 'Response', value: responseMessage || 'No response provided' }
            );
    }

    appendToChatLog(prompt, completion) {
        const dataLine = JSON.stringify({ prompt, completion }) + '\n';
        fs.appendFile(this.chatLogFilePath, dataLine, (err) => {
            if (err) {
                logger.error('Error appending to the chat log', { error: err.message });
            } else {
                logger.info('Successfully appended to the chat log');
            }
        });
    }
}

module.exports = BotHandler;