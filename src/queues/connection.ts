import { config } from '@scrapper/config';

import client, { Channel } from 'amqplib';
import { Logger } from 'winston';
import { winstonLogger } from '@scrapper/utilis/looger'

const log: Logger = winstonLogger(`${config.ELASTIC_SEARCH_URL}`, 'apiScrapperQueueConnection', 'debug');

let connection: Connection;
let sharedChannel: Channel;

// async function createConnection(): Promise<Channel | undefined> {
//   if (sharedChannel) return sharedChannel;

//   connection = await client.connect(`${config.RABBITMQ_ENDPOINT}`);
//   sharedChannel = await connection.createChannel();

//   log.info('RabbitMQ connection & channel established');

//   // Graceful shutdown
//   process.once('SIGINT', async () => {
//     await sharedChannel.close();
//     await connection.close();
//     log.info('RabbitMQ connection closed');
//   });

//   return sharedChannel;
// }

async function createConnection(): Promise<Channel> {
  if (sharedChannel) return sharedChannel;

  const connectWithRetry = async (retryCount = 0): Promise<Channel> => {
    try {
      connection = await client.connect(`${config.RABBITMQ_ENDPOINT}?heartbeat=30`);
      sharedChannel = await connection.createChannel();

      log.info('RabbitMQ connection & channel established');

      // 🔌 Handle unexpected close
      connection.on('close', () => {
        log.error('💥 RabbitMQ connection closed unexpectedly. Reconnecting...');
        sharedChannel = undefined as unknown as Channel;
        setTimeout(() => connectWithRetry(retryCount + 1), 5000);
      });

      connection.on('error', (err) => {
        log.error(`❗ RabbitMQ connection error: ${err.message}`);
      });

      // 🔁 Graceful shutdown
      process.once('SIGINT', async () => {
        try {
          await sharedChannel?.close();
          await connection?.close();
          log.info('👋 RabbitMQ connection closed gracefully');
          process.exit(0);
        } catch (e: any) {
          log.error('Error during shutdown: ' + e.message);
          process.exit(1);
        }
      });

      return sharedChannel;
    } catch (err: any) {
      log.error(`❌ RabbitMQ connection failed: ${err.message}`);
      if (retryCount < 5) {
        log.info(`🔄 Retrying connection... Attempt ${retryCount + 1}`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
        return connectWithRetry(retryCount + 1);
      } else {
        log.error('🚫 Max retries reached. Could not connect to RabbitMQ.');
        throw err;
      }
    }
  };

  return await connectWithRetry();
}


export { createConnection };


export interface Connection extends events.EventEmitter {
    close(): Promise<void>;
    createChannel(): Promise<Channel>;
    createConfirmChannel(): Promise<ConfirmChannel>;
    connection: {
        serverProperties: ServerProperties;
    };
}

export interface ConfirmChannel extends Channel {
    publish(
        exchange: string,
        routingKey: string,
        content: Buffer,
        options?: Publish,
        callback?: (err: any, ok: Empty) => void,
    ): boolean;
    sendToQueue(
        queue: string,
        content: Buffer,
        options?: Publish,
        callback?: (err: any, ok: Empty) => void,
    ): boolean;

    waitForConfirms(): Promise<void>;
}

export interface  Empty  {
    }
export interface Publish extends Channel {
      expiration?: string | number | undefined;
      userId?: string | undefined;
      CC?: string | string[] | undefined;

      mandatory?: boolean | undefined;
      persistent?: boolean | undefined;
      deliveryMode?: boolean | number | undefined;
      BCC?: string | string[] | undefined;

      contentType?: string | undefined;
      contentEncoding?: string | undefined;
      headers?: any;
      priority?: number | undefined;
      correlationId?: string | undefined;
      replyTo?: string | undefined;
      messageId?: string | undefined;
      timestamp?: number | undefined;
      type?: string | undefined;
      appId?: string | undefined;

}

export interface ServerProperties {
    host: string;
    product: string;
    version: string;
    platform: string;
    copyright?: string | undefined;
    information: string;
    [key: string]: string | undefined;
}

import * as events from "events";