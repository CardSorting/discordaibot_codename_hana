const { SlashCommandBuilder, EmbedBuilder } = require("@discordjs/builders");
const { OpenAI } = require("openai");
const fs = require("fs");
const path = require("path");
const fastq = require("fastq");
const Database = require('better-sqlite3');
class AskSlashCommand {
  constructor(client, openAIToken, userLastChannelMapCache, creditManager) {
    this.data = this._buildCommandData();
    this.client = client;
    this.openAI = new OpenAI({
      apiKey: openAIToken,
      baseURL: "https://api.endpoints.anyscale.com/v1",
    });
    this.userLastChannelMapCache = userLastChannelMapCache;
    this.dbFilePath = path.join(__dirname, "chatlog.db");
    this.db = new Database(this.dbFilePath);
    this.setupDatabase();
    this.queryQueue = fastq(this, this.processQuery, 1);
    this.creditManager = creditManager;
  }
  _buildCommandData() {
    return new SlashCommandBuilder()
      .setName("ask")
      .setDescription("Submit a query for the bot to process")
      .addStringOption((option) =>
        option
          .setName("query")
          .setDescription("The query text")
          .setRequired(true),
      );
  }

  setupDatabase() {
    const tableCreationQuery = `
      CREATE TABLE IF NOT EXISTS chat_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId TEXT,
        originalQuery TEXT,
        response TEXT,
        timestamp TEXT
      )`;
    this.db.prepare(tableCreationQuery).run();
  }

  async processQuery(task, callback) {
    try {
      // Deduct credits from the user's balance before proceeding with processing the query
      const hasEnoughCredits = await this.creditManager.deductUserCredits(
        task.userId,
        this.creditManager.QUERY_COMMAND_COST,
      );
      if (!hasEnoughCredits) {
        throw new Error(
          "You do not have enough credits to perform this action.",
        );
      }

      const completion = await this.openAI.chat.completions.create({
        model: "mistralai/Mixtral-8x7B-Instruct-v0.1",
        messages: task.messages,
        temperature: 0.7,
      });

      if (!completion.choices || completion.choices.length === 0) {
        throw new Error("OpenAI returned an empty response.");
      }

      const firstChoice = completion.choices[0];
      if (!firstChoice.message || !firstChoice.message.content) {
        throw new Error("OpenAI response is missing message content.");
      }

      const responseMessage = firstChoice.message.content.trim();
      await this.respondToUser(
        task.userId,
        task.originalQuery,
        responseMessage,
        task.channelId,
      );

      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  async execute(interaction) {
    const userId = interaction.user.id;
    const originalQuery = interaction.options.getString("query");
    const channelId = interaction.channelId;

    if (!userId || !channelId || !originalQuery) {
      interaction.reply({
        content: "Invalid input parameters for /ask command execution.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    this.userLastChannelMapCache.set(
      userId,
      channelId,
      "discord",
      originalQuery,
      null
    );

    const task = {
      messages: [
        {
          role: "system",
          content:
            "You are to roleplay as Seraphina a cyborg. Your traits are stoic cold and harsh. However, you are quite intelligent and conversational.",
        },
        { role: "user", content: originalQuery },
      ],
      userId,
      originalQuery,
      channelId,
    };

    this.queryQueue.push(task, (err) => {
      if (err) {
        interaction
          .followUp({ content: `Error: ${err.message}`, ephemeral: true })
          .catch(console.error);
      }
    });
  }

  async respondToUser(userId, originalQuery, responseMessage, channelId) {
    try {
      const channel = await this.client.channels.fetch(channelId);
      const user = await this.client.users.fetch(userId);

      const embed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle("Response to your Query")
        .addFields(
          { name: "Your Query", value: originalQuery },
          {
            name: "Seraphina's Response",
            value: responseMessage || "No response was generated",
          },
        )
        .setFooter({
          text: `Requested by ${user.tag}`,
          iconURL: user.displayAvatarURL(),
        })
        .setTimestamp(new Date());

      await channel.send({ embeds: [embed] });
      this.appendToChatLog(userId, originalQuery, responseMessage);
    } catch (error) {
      console.error("Failed to send response to the user.", error);
    }
  }

  appendToChatLog(userId, originalQuery, response) {
    const timestamp = new Date().toISOString();
    const insertQuery = `
      INSERT INTO chat_logs (userId, originalQuery, response, timestamp)
      VALUES (?, ?, ?, ?)`;
    this.db.prepare(insertQuery).run(userId, originalQuery, response, timestamp);
  }
}

module.exports = AskSlashCommand;