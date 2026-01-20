import express, { Express } from 'express';
import { ScrapperServer } from '@scrapper/server';

class Application {
  public initialize(): void {
    const app: Express = express();
    const server: ScrapperServer = new ScrapperServer(app);
    server.start();
  }
}

const application: Application = new Application();
application.initialize();
