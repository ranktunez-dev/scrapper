import { config } from '@scrapper/config';
// import { winstonLogger } from '@ranktunez-dev/ranktunez-app';
import { Channel } from 'amqplib';
import { Logger } from 'winston';
import { createConnection } from '@scrapper/queues/connection';
import { ScrapperChannel } from '@scrapper/server';
import { winstonLogger } from '@scrapper/utilis/looger'

const log: Logger = winstonLogger(`${config.ELASTIC_SEARCH_URL}`, 'apiScrapperServiceProducer', 'debug');

const API_ACTIVITY_QUEUE = 'api_activity_queue';

export async function publishMessage(channel: Channel | undefined, queue: string, message: string, logMessage: string): Promise<void> {
  try {
    if (!channel) {
      channel = (await createConnection()) as Channel;
    }

    await channel.assertQueue(queue, { durable: true }); // Ensure the queue exists

    channel.sendToQueue(queue, Buffer.from(message)); // Publish message to the queue
    log.info(logMessage); // Log the message being sent
  } catch (error) {
    log.error('Error publishing message:', error);
  }
}

export async function publishApiActivity(message: string): Promise<void> {
  const logMessage = 'Publishing Api Acitivity';

  await publishMessage(ScrapperChannel, API_ACTIVITY_QUEUE, message, logMessage);
}
