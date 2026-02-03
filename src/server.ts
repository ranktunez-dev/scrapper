import hpp from 'hpp';
import cors from 'cors';
import http from 'http';
import helmet from 'helmet';
// import { Logger } from 'winston';
import { Channel } from 'amqplib';
import compression from 'compression';
import { config } from '@scrapper/config';
import cookieSession from 'cookie-session';
import { appRoutes } from '@scrapper/routes';
import { rateLimit } from 'express-rate-limit';
import { StatusCodes } from 'http-status-codes';
// // import { elasticSearch } from '@scrapper/elasticsearch';
import { Application,
   json, 
  NextFunction, Request, Response, 
  urlencoded 
  } from 'express';
// import { createConnection } from '@scrapper/queues/connection';
// // import { checkRedisConnection } from '@scrapper/redis';
// import { winstonLogger } from './utilis/looger';

export interface IErrorResponse {
    message: string;
    statusCode: number;
    status: string;
    comingFrom: string;
    stack?: string;
    serializeErrors(): IError;
}

export interface IError {
    message: string;
    statusCode: number;
    status: string;
    comingFrom: string;
}


const SERVER_PORT = 8025;
// const log: Logger = winstonLogger(`${config.ELASTIC_SEARCH_URL}`, 'apiScrapperService', 'debug');

export let ScrapperChannel: Channel;
export class ScrapperServer {
  private app: Application;

  constructor(app: Application) {
    this.app = app;
  }

  public start(): void {
    this.securityMiddleware(this.app);
    this.standardMiddleware(this.app);
    this.rateLimiter(this.app);
    this.routesMiddleware(this.app);
  //   // this.startElasticSearch();
    this.errorHandler(this.app);
  //   // this.startRedis();
    // this.startQueues();
    this.startServer(this.app);
  }

  private securityMiddleware(app: Application): void {
    app.set('trust proxy', 1);
    app.use(
      cookieSession({
        name: 'session',
        keys: [`${config.SECRET_KEY_ONE}`, `${config.SECRET_KEY_TWO}`],
        maxAge: 1000 * 60 * 60 * 24,
        secure: config.NODE_ENV !== 'development', // set it to true once we use https for development it will be http that's why it is set to false
        sameSite: 'lax'
        // domain: 'app.adtunez.com'
      })
    );
    app.use(hpp());
    app.use(helmet());
    app.use(
      cors({
        origin: config.CLIENT_URL,
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
      })
    );
  }

  private standardMiddleware(app: Application): void {
    app.use(compression());
    app.use(json({ limit: '200mb' }));
    app.use(urlencoded({ extended: true, limit: '200mb' }));
  }

  private routesMiddleware(app: Application): void {
    appRoutes(app);
  }

//   // private startElasticSearch(): void {
//   //   elasticSearch.checkConnection();
//   // }

  private errorHandler(app: Application): void {
    // 404 handler
    app.use((req: Request, res: Response) => {
      const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
      console.log('error', `${fullUrl} endpoint does not exist`, '');

      res
        .status(StatusCodes.NOT_FOUND)
        .json({ message: 'The endpoint called does not exist' });
    });

    // Custom Error-Handling Middleware (must have 4 params)
    app.use(
      (error: IErrorResponse, _req: Request, res: Response, _next: NextFunction) => {
        console.log('error', `ScrapperService error ${error.comingFrom}: `, error);

        res
          .status(error.statusCode || StatusCodes.INTERNAL_SERVER_ERROR)
          .json(error);
      }
    );
  }


//   // private startRedis(): void {
//   //   checkRedisConnection();
//   // }

  // private async startQueues(): Promise<void> {
  //   ScrapperChannel = (await createConnection()) as Channel;
  // }

  private async startServer(app: Application): Promise<void> {
    try {
      const httpServer: http.Server = new http.Server(app);
      this.startHttpServer(httpServer);
    } catch (error) {
      console.log('error', 'ScrapperService startServer() error method:', error);
    }
  }

  private async rateLimiter(app: Application): Promise<void> {
    // Configure rate limiter
    const limiter = rateLimit({
      windowMs: 1 * 60 * 1000, // 1 minute
      max: 100, // Limit each IP to 100 requests per `windowMs`
      message: {
        status: false,
        statusCode: 429,
        error: 'Too many requests',
        message: 'You have exceeded the request limit. Please try again later.'
      },
      standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
      legacyHeaders: false // Disable `X-RateLimit-*` headers
    });
    // Apply to all requests
    app.use(limiter);
  }

  private async startHttpServer(httpServer: http.Server): Promise<void> {
    try {
      console.info(`Scrapper server has started with process id ${process.pid}`);
      httpServer.listen(SERVER_PORT, () => {
        console.info(`Scrapper server running on port ${SERVER_PORT}`);
      });
    } catch (error) {
      console.log('error', 'ScrapperService startServer() error method:', error);
    }
  }
}
